/* 央视新闻（cctvnews）直播 CJS 插件
 * 网关取流 + AES-128-CBC 解密 + 多码流探测 + 浏览器 Cookie 模拟
 * 用法：?id=cctv13 或 https://tv.cctv.com/live/cctv13/
 */
var API = 'https://gateway2.cctvnews.cctv.com/1.0.0/feed/article/live/detail';
var CA_APPKEY = '204133710';
var CA_SECRET = 'etyEuNdA7GvQU7iPZHqnrBpSFfRyKQTD';
var REFERER = 'https://m-live.cctvnews.cctv.com/';
var ORIGIN = 'https://m-live.cctvnews.cctv.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
var COOKIE_KEY = 'cctvnews_cookie';
var COOKIE_TTL = 86400;

/* 频道 key -> roomId */
var CHANNELS = {
    cctv1: '11200132825562653886',
    cctv2: '12030532124776958103',
    cctv4: '10620168294224708952',
    cctv7: '8516529981177953694',
    cctv9: '7252237247689203957',
    cctv10: '14589146016461298119',
    cctv12: '13180385922471124325',
    cctv13: '16265686808730585228',
    cctv17: '4496917190172866934',
    cctv4k: '2127841942201075403'
};

var NAMES = {
    cctv1: 'CCTV-1 综合',
    cctv2: 'CCTV-2 财经',
    cctv4: 'CCTV-4 中文国际',
    cctv7: 'CCTV-7 国防军事',
    cctv9: 'CCTV-9 纪录',
    cctv10: 'CCTV-10 科教',
    cctv12: 'CCTV-12 社会与法',
    cctv13: 'CCTV-13 新闻',
    cctv17: 'CCTV-17 农业农村',
    cctv4k: 'CCTV-4K 超高清'
};

function randHex(n) {
    var s = '', i;
    for (i = 0; i < n; i++) s += '0123456789abcdef'.charAt(Math.floor(Math.random() * 16));
    return s;
}

function randStr(n) {
    var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', s = '', i;
    for (i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
}

function uuid() {
    return randHex(8) + '-' + randHex(4) + '-4' + randHex(3) + '-' + randHex(4) + '-' + randHex(12);
}

/* CDN 按 Cookie 识别浏览器会话，带浏览器 Cookie 的请求不受会话时长限制 */
function browserCookie() {
    var cached = cjs.getCache(COOKIE_KEY);
    if (cached) {
        /* 桥接 setCache 内部会 JSON.stringify(v)，取出时带引号，需还原 */
        var s = String(cached);
        if (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
            try { s = JSON.parse(s); } catch (e) {}
        }
        if (s.length > 20) return s;
    }
    var ck = 'client_id=' + randHex(32) +
        '; p_h5_u=' + uuid().toUpperCase() +
        '; selectedCC=off; _bl_uid=' + randStr(28);
    cjs.setCache(COOKIE_KEY, ck, COOKIE_TTL);
    return ck;
}

function baseHeaders() {
    return {
        'User-Agent': UA,
        'Referer': REFERER,
        'Origin': ORIGIN,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cookie': browserCookie()
    };
}

function httpGet(url, headers) {
    var resp = cjs.request(url, 'GET', headers, '', true);
    if (!resp || resp.code !== 200) throw new Error('HTTP ' + ((resp && resp.code) || 0));
    return resp.body || '';
}

/* CryptoJS 由运行时注入（与内置 opensslEncrypt 同一实现） */
function hmacSha256Base64(msg, key) {
    var C = require('crypto');
    return C.HmacSHA256(msg, key).toString(C.enc.Base64);
}

function signRequest(method, pathWithQuery, t) {
    var s = method + '\n' +
        'application/json\n' +
        '\n\n\n' +
        'x-ca-key:' + CA_APPKEY + '\n' +
        'x-ca-stage:RELEASE\n' +
        'x-ca-timestamp:' + t + '\n' +
        pathWithQuery;
    return hmacSha256Base64(s, CA_SECRET);
}

function decodeB64Text(b64) {
    return cjs.decodeBase64(String(b64 || '').replace(/\s/g, ''));
}

function decryptUrl(v, key, iv) {
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    return cjs.opensslDecrypt(v, 'AES-128-CBC', key, 0, iv);
}

function normalize(s) {
    return String(s || '').toLowerCase()
        .replace(/cctv[\s\-_]*/g, '')
        .replace(/频道|高清|超高清|直播/g, '')
        .replace(/[\s\-_()（）·]/g, '');
}

function resolveChannel(raw) {
    var key = String(raw || '').trim();
    if (!key) return null;
    var lower = key.toLowerCase().replace(/[^a-z0-9+]/g, '');
    if (CHANNELS[lower]) return lower;
    var i, k;
    for (k in CHANNELS) {
        if (CHANNELS[k] === key) return k;
    }
    var norm = normalize(key);
    if (norm === '1' || norm === '') return null;
    for (k in CHANNELS) {
        var nk = normalize(k);
        if (nk === norm) return k;
    }
    return null;
}

function pickId(item) {
    var v = item.id || item.channel || item.ch || item.roomId || item.liveRoomNumber || '';
    if (!v && item.params) {
        var p = item.params;
        v = p.id || p.channel || p.ch || p.roomId || p.liveRoomNumber || '';
    }
    if (!v && item.url) {
        var s = String(item.url);
        var m = s.match(/[?&](?:id|roomId|liveRoomNumber)=([^&#]+)/i) ||
            s.match(/live\/(cctv[0-9a-z+]+)/i);
        if (m) v = decodeURIComponent(m[1]);
    }
    return v;
}

function orderFor(quality) {
    var q = String(quality || '').toLowerCase();
    if (q === 'medium') return ['mhd', 'mbd', 'mud'];
    if (q === 'low') return ['mud', 'mbd', 'mhd'];
    return ['mbd', 'mhd', 'mud'];
}

function fetchStreams(room) {
    var t = String(new Date().getTime());
    var path = '?articleId=' + encodeURIComponent(room) + '&scene_type=6';
    var query = '/1.0.0/feed/article/live/detail' + path;
    var sig = signRequest('GET', query, t);
    var clientId = uuid();
    var xReqTs = Number(t) - 1;

    var headers = {
        'accept': 'application/json',
        'cookieuid': clientId,
        'from-client': 'h5',
        'referer': REFERER,
        'userid': clientId,
        'x-ca-key': CA_APPKEY,
        'x-ca-stage': 'RELEASE',
        'x-ca-signature': sig,
        'x-ca-signature-headers': 'x-ca-key,x-ca-stage,x-ca-timestamp',
        'x-ca-timestamp': t,
        'x-req-ts': String(xReqTs),
        'x-request-id': clientId,
        'User-Agent': UA,
        'Cookie': browserCookie()
    };

    var text = httpGet(API + path, headers);
    var obj = JSON.parse(text);
    if (!obj || !obj.response) throw new Error('取流接口无 response');
    var inner = JSON.parse(decodeB64Text(obj.response));
    var d = (inner && inner.data) || {};
    if (!d.live_room) throw new Error('取流接口无数据');

    var dk = String(d.dk || '');
    var cams = d.live_room.liveCameraList || [];
    var authUrl = '', demotes = [], i, j;
    for (i = 0; i < cams.length; i++) {
        var pulls = cams[i].pullUrlList || [];
        for (j = 0; j < pulls.length; j++) {
            var p = pulls[j];
            if (String(p.format || '').toUpperCase() !== 'HLS') continue;
            var ar = p.authResultUrl || [];
            if (ar.length && ar[0] && ar[0].authUrl) {
                authUrl = ar[0].authUrl;
                demotes = ar[0].demote_urls || [];
                if (p['def'] === 1) break;
            }
        }
        if (authUrl) break;
    }
    if (!authUrl) throw new Error('未找到 HLS 流');

    var secs = String(xReqTs).slice(0, -3);
    var key = dk.slice(0, 8) + secs.slice(-8);
    var iv = dk.slice(-8) + secs.slice(0, 8);

    var list = [];
    var main = decryptUrl(authUrl, key, iv);
    if (main) list.push({ kind: 'mbd', url: main, pri: 0 });
    for (i = 0; i < demotes.length; i++) {
        var du = demotes[i] || {};
        var raw = du.originUrl || du.authUrl || '';
        if (!raw) continue;
        var dec = '';
        try {
            dec = decryptUrl(raw, key, iv);
        } catch (e) {
            continue;
        }
        if (!/^https?:\/\//i.test(dec)) continue;
        var kind = dec.indexOf('_mhd.') >= 0 ? 'mhd' : (dec.indexOf('_mud.') >= 0 ? 'mud' : 'mbd');
        list.push({ kind: kind, url: dec, pri: kind === 'mhd' ? 1 : 2 });
    }
    return list;
}

function probe(url, headers) {
    try {
        var body = httpGet(url, headers);
        return body.indexOf('#EXTINF') >= 0;
    } catch (e) {
        return false;
    }
}

function main(item) {
    var input = item || {};
    var key = resolveChannel(pickId(input));
    if (!key) throw new Error('未识别的频道: ' + pickId(input));

    var room = CHANNELS[key];
    var order = orderFor(input.quality);
    var hdrs = baseHeaders();
    var streams = [], i, k, attempt;

    /* 取流 + 探测：优先给播放器一条已验证可用的地址，最多重取 3 次 */
    for (attempt = 0; attempt < 3; attempt++) {
        try {
            streams = fetchStreams(room);
        } catch (e) {
            streams = [];
        }
        for (i = 0; i < order.length; i++) {
            for (k = 0; k < streams.length; k++) {
                if (streams[k].kind !== order[i]) continue;
                if (probe(streams[k].url, hdrs)) {
                    return {
                        url: streams[k].url,
                        headers: hdrs,
                        referer: REFERER,
                        userAgent: UA,
                        cookies: browserCookie(),
                        title: NAMES[key],
                        ttlSec: 60
                    };
                }
            }
        }
    }

    /* 全部探测失败时仍下发首选地址，交给播放器自行重试/换源 */
    if (streams.length) {
        for (i = 0; i < order.length; i++) {
            for (k = 0; k < streams.length; k++) {
                if (streams[k].kind === order[i]) {
                    return {
                        url: streams[k].url,
                        headers: hdrs,
                        referer: REFERER,
                        userAgent: UA,
                        cookies: browserCookie(),
                        title: NAMES[key],
                        ttlSec: 60
                    };
                }
            }
        }
    }
    throw new Error('获取直播流失败（' + NAMES[key] + '）');
}
