/* 深圳广电 (sztv.com.cn) CJS 直播站点插件
 * 纯 JS 实现，依赖 cjs 桥接提供的 HTTP / MD5 / Base64 / 缓存能力。
 * 输入的 id 可以是：
 *   1) 网页频道数字 id，例如 https://www.sztv.com.cn/dianshi.shtml?id=7867
 *   2) 频道名称，例如 深圳卫视 / 都市频道
 *   3) info.json 中的 liveId，例如 AxeFRth
 */
var INFO_URL = 'https://sztv-live.sztv.com.cn/info.json';
var KEY_API = 'https://hls-api.sztv.com.cn/getCutvHlsLiveKey';
var STREAM_HOST = 'https://sztv-live.sztv.com.cn';
var SALT_TOKEN = 'cutvLiveStream|Dream2017';
var SALT_SIGN = 'ejow6p6p6hmrm9g96beh2knecdq5kyw9bp0zxyg7';
var SIGN_PADDING = 7200;
var CHANNEL_CACHE_TTL = 300;
var WARMUP_CACHE_TTL = 300;
var REFERER = 'https://www.sztv.com.cn/';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

/* 网页频道数字 id -> info.json 频道名 */
var PAGE_ID_NAMES = {
    '24725': '深圳卫视-4k',
    '7867': '深圳卫视',
    '7868': '深圳都市频道',
    '7880': '深圳电视剧频道',
    '7871': '财经频道',
    '7881': '深圳少儿频道',
    '7869': '移动频道',
    '7878': '宜和购物频道',
    '7944': '国际频道'
};

function httpGet(url) {
    var resp = cjs.request(url, 'GET', { 'User-Agent': UA, 'Referer': REFERER }, '', true);
    if (!resp || resp.code !== 200) throw new Error('HTTP ' + (resp && resp.code || 0) + ' ' + url);
    return resp.body || '';
}

function unobfuscate(b64) {
    var raw = b64.split('').reverse().join('');
    var split = raw.length - Math.floor(raw.length / 2);
    raw = raw.substring(split) + raw.substring(0, split);
    return cjs.decodeBase64(raw);
}

function getChannels() {
    var cached = cjs.getCache('sztv_channels');
    if (cached && cached.length) return cached;
    var list;
    try {
        list = JSON.parse(httpGet(INFO_URL));
    } catch (e) {
        throw new Error('频道列表解析失败');
    }
    if (!list || !list.length) throw new Error('频道列表为空');
    cjs.setCache('sztv_channels', list, CHANNEL_CACHE_TTL);
    return list;
}

function normalize(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[\s\-_().·]/g, '')
        .replace(/深圳/g, '')
        .replace(/频道/g, '')
        .replace(/广播/g, '');
}

function findChannel(key, list) {
    var raw = String(key || '').trim();
    if (!raw) return null;
    if (PAGE_ID_NAMES[raw]) raw = PAGE_ID_NAMES[raw];
    var lower = raw.toLowerCase();
    var norm = normalize(raw);
    var i, c, best = null, bestScore = 0;
    for (i = 0; i < list.length; i++) {
        c = list[i] || {};
        if (String(c.p || '').toLowerCase() === lower) return c;
        if (String(c.n || '') === raw) return c;
    }
    if (norm.length < 2) return null;
    for (i = 0; i < list.length; i++) {
        c = list[i] || {};
        var n = normalize(c.n);
        if (!n) continue;
        var score = 0;
        if (n === norm) {
            score = 100;
        } else if (n.indexOf(norm) >= 0) {
            score = 80 + norm.length;
        } else if (norm.indexOf(n) >= 0) {
            score = 60 + n.length;
        }
        if (score > bestScore) {
            bestScore = score;
            best = c;
        }
    }
    return bestScore >= 60 ? best : null;
}

function warmup() {
    if (cjs.getCache('sztv_warmup')) return;
    try {
        httpGet(STREAM_HOST + '/favicon.ico');
    } catch (e) {}
    cjs.setCache('sztv_warmup', 1, WARMUP_CACHE_TTL);
}

function getLiveKey(chId, t) {
    var token = cjs.md5(t + chId + SALT_TOKEN);
    var url = KEY_API + '?t=' + t + '&id=' + encodeURIComponent(chId) + '&token=' + token + '&at=1';
    var b64 = httpGet(url).replace(/^"|"$/g, '').trim();
    if (!b64) throw new Error('直播密钥为空');
    return unobfuscate(b64);
}

function fetchPlaylist(url) {
    var resp;
    try {
        resp = cjs.request(url, 'GET', { 'User-Agent': UA, 'Referer': REFERER }, '', true);
    } catch (e) {
        return '';
    }
    if (!resp || resp.code !== 200) return '';
    var body = resp.body || '';
    return body.indexOf('#EXTINF') >= 0 ? body : '';
}

/* 源站 CDN 偶发返回 200 + 空 body（X-Error-Info: auth_remote），
 * 播放器拿到空列表会判定线路失败并重连，表现为长时间缓冲。
 * 交付给播放器之前先自取一次列表，空列表则换签名重试，
 * 保证播放器第一次拿到的地址就是可用的。 */
function resolveStream(chId, bitrate) {
    var base = Math.floor(Date.now() / 1000);
    var aa = getLiveKey(chId, base);
    var url = '';
    var i;
    for (i = 0; i < 5; i++) {
        url = signedM3u8(chId, bitrate, aa, base + i);
        if (fetchPlaylist(url)) return url;
    }
    return url;
}

function signedM3u8(chId, bitrate, aa, t) {
    var path = '/' + chId + '/' + bitrate + '/' + aa + '.m3u8';
    var hexT = (t + SIGN_PADDING).toString(16);
    var sign = cjs.md5(SALT_SIGN + path + hexT);
    return STREAM_HOST + path + '?sign=' + sign + '&t=' + hexT;
}

function main(item) {
    var url = String(item && item.url || '');
    var id = '';
    if (item && item.id !== undefined && item.id !== null && item.id !== '') id = String(item.id);
    if (!id && item && item.params) id = item.params.id || item.params.channel || '';
    if (!id) {
        try {
            var parsed = cjs.Uri(url);
            id = (parsed.Params && (parsed.Params.id || parsed.Params.channel)) || '';
        } catch (e) {}
    }
    if (!id) {
        var m = /[?&]id=([^&]+)/.exec(url);
        if (m) id = decodeURIComponent(m[1]);
    }
    if (!id) throw new Error('缺少频道参数 id');

    warmup();

    var list = getChannels();
    var ch = findChannel(id, list);
    if (!ch) throw new Error('未找到频道: ' + id);

    var chId = ch.p;
    var bitrate = (ch.r && ch.r[0]) ? String(ch.r[0]) : '500';
    var m3u8 = resolveStream(chId, bitrate);

    return {
        url: m3u8,
        headers: { 'User-Agent': UA, 'Referer': REFERER },
        referer: REFERER
    };
}
