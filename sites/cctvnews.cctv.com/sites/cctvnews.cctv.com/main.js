/* 央视新闻（cctvnews）直播 CJS 插件
 * 严格按 cctvnews.py 移植：网关取流 + AES-128-CBC 解密 + 多码流 + 浏览器 Cookie 模拟
 * 用法：?id=cctv13 或 ?id=16265686808730585228
 */
var CA_HOST = 'https://gateway2.cctvnews.cctv.com';
var CA_PATH = '/1.0.0/feed/article/live/detail';
var CA_APPKEY = '204133710';
var CA_SECRET = 'etyEuNdA7GvQU7iPZHqnrBpSFfRyKQTD';

var REFERER = 'https://m-live.cctvnews.cctv.com/';
var ORIGIN = 'https://m-live.cctvnews.cctv.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

var COOKIE_KEY = 'cctvnews_cookie';
var COOKIE_TTL = 86400;
var GOOD_KEY = 'cctvnews_good_';
var GOOD_TTL = 30;

/* 频道 key -> roomId（与 py 的 CHANNELS 完全一致） */
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

var HEX = '0123456789abcdef';
var ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randHex(n) {
    var s = '', i;
    for (i = 0; i < n; i++) s += HEX.charAt(Math.floor(Math.random() * 16));
    return s;
}

function randStr(n) {
    var s = '', i;
    for (i = 0; i < n; i++) s += ALNUM.charAt(Math.floor(Math.random() * ALNUM.length));
    return s;
}

/* py _create_uuid(): '%04x%04x%04x4%03x%04x%04x%04x%04x' —— 32 位，无连字符 */
function createUuid() {
    return randHex(4) + randHex(4) + randHex(4) + '4' + randHex(3) +
        randHex(4) + randHex(4) + randHex(4) + randHex(4);
}

/* py uuid.uuid4() 的带连字符形式，用于 p_h5_u */
function uuid4() {
    return randHex(8) + '-' + randHex(4) + '-4' + randHex(3) + '-' + randHex(4) + '-' + randHex(12);
}

/* py _gen_browser_cookie()：模块级只生成一次，这里用缓存保持同一会话 */
function browserCookie() {
    var cached = cjs.getCache(COOKIE_KEY);
    if (cached) {
        var s = String(cached);
        if (s.length > 20) return s;
    }
    var ck = 'client_id=' + randHex(32) +
        '; p_h5_u=' + uuid4().toUpperCase() +
        '; selectedCC=off; _bl_uid=' + randStr(28);
    cjs.setCache(COOKIE_KEY, ck, COOKIE_TTL);
    return ck;
}

/* py HDR */
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

function hmacSha256Base64(msg, key) {
    var C = require('crypto');
    return C.HmacSHA256(msg, key).toString(C.enc.Base64);
}

/* py _sign_request() */
function signRequest(method, pathWithQuery, t) {
    var signStr = method + '\n' +
        'application/json\n' +
        '\n' +
        '\n' +
        '\n' +
        'x-ca-key:' + CA_APPKEY + '\n' +
        'x-ca-stage:RELEASE\n' +
        'x-ca-timestamp:' + t + '\n' +
        pathWithQuery;
    return hmacSha256Base64(signStr, CA_SECRET);
}

/* py _get_key_iv() */
function getKeyIv(dk, xReqTs) {
    var er = dk || '';
    var eoTrimmed = String(xReqTs).slice(0, -3);
    return {
        key: er.slice(0, 8) + eoTrimmed.slice(-8),
        iv: er.slice(-8) + eoTrimmed.slice(0, 8)
    };
}

/* py _aes_decrypt_b64()：AES-128-CBC + PKCS7 */
function aesDecryptB64(v, key, iv) {
    return cjs.opensslDecrypt(String(v), 'AES-128-CBC', key, 0, iv);
}

function decryptStreamUrl(raw, key, iv) {
    var u = String(raw || '');
    if (!u) return '';
    if (u.toLowerCase().indexOf('http') === 0) return u;
    return aesDecryptB64(u, key, iv);
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
    var k;
    for (k in CHANNELS) {
        if (CHANNELS[k] === key) return k;
    }
    var norm = normalize(key);
    if (norm === '') return null;
    for (k in CHANNELS) {
        if (normalize(k) === norm) return k;
    }
    return null;
}

/* 从页面/链接里抽取频道标识（roomId 或 cctv13） */
function extractFromUrl(s) {
    var m = String(s).match(/[?&](?:id|roomId|liveRoomNumber)=([^&#]+)/i) ||
        String(s).match(/live\/(cctv[0-9a-z+]+)/i);
    return m ? decodeURIComponent(m[1]) : '';
}

function pickId(item) {
    var v = item.id || item.channel || item.ch || item.roomId || item.liveRoomNumber || '';
    if (!v && item.params) {
        var p = item.params;
        v = p.id || p.channel || p.ch || p.roomId || p.liveRoomNumber || '';
    }
    if (v && String(v).indexOf('://') >= 0) {
        var e = extractFromUrl(v);
        if (e) return e;
    }
    if (!v && item.url) v = extractFromUrl(item.url);
    if (!v && item.pageUrl) v = extractFromUrl(item.pageUrl);
    return v;
}

/* py _get_m3u8_urls()：priority 0=mbd 1=mhd 2=mud，稳定性排序 */
function getM3u8Urls(key) {
    var room = CHANNELS[key];
    if (!room) return [];
    var t = String(new Date().getTime());
    var query = 'articleId=' + room + '&scene_type=6';
    var pathWithQuery = CA_PATH + '?' + query;
    var url = CA_HOST + pathWithQuery;
    var sign = signRequest('GET', pathWithQuery, t);
    var clientId = createUuid();
    var xReqTs = Number(t) - 1;

    var headers = {
        'accept': 'application/json',
        'cookieuid': clientId,
        'from-client': 'h5',
        'referer': REFERER,
        'userid': clientId,
        'x-ca-key': CA_APPKEY,
        'x-ca-stage': 'RELEASE',
        'x-ca-signature': sign,
        'x-ca-signature-headers': 'x-ca-key,x-ca-stage,x-ca-timestamp',
        'x-ca-timestamp': t,
        'x-req-ts': String(xReqTs),
        'x-request-id': clientId,
        'User-Agent': UA,
        'Cookie': browserCookie()
    };

    var text;
    try {
        text = httpGet(url, headers);
    } catch (e) {
        return [];
    }
    var data;
    try {
        data = JSON.parse(text);
    } catch (e2) {
        return [];
    }
    if (!data || !data.response) return [];

    var respData;
    try {
        respData = JSON.parse(cjs.decodeBase64(String(data.response)));
    } catch (e3) {
        return [];
    }
    if (!respData || !respData.data) return [];

    var d = respData.data;
    var liveRoom = d.live_room || {};
    var cameraList = liveRoom.liveCameraList || [];
    var dk = d.dk || '';
    if (!cameraList.length) return [];

    var authUrl = '', demoteList = [], i, j;
    for (i = 0; i < cameraList.length; i++) {
        var pullList = cameraList[i].pullUrlList || [];
        for (j = 0; j < pullList.length; j++) {
            var pull = pullList[j];
            if (String(pull.format || '').toUpperCase() !== 'HLS') continue;
            var authResult = pull.authResultUrl || [];
            if (authResult.length && authResult[0] && authResult[0].authUrl) {
                authUrl = authResult[0].authUrl;
                demoteList = authResult[0].demote_urls || [];
                if (pull['def'] === 1) break;
            }
        }
        if (authUrl) break;
    }
    if (!authUrl) return [];

    var ki = getKeyIv(dk, xReqTs);

    var mainUrl = '';
    try {
        mainUrl = decryptStreamUrl(authUrl, ki.key, ki.iv);
    } catch (e4) {
        mainUrl = '';
    }

    var list = [];
    if (mainUrl && mainUrl.toLowerCase().indexOf('http') === 0) {
        list.push({ url: mainUrl, pri: 0 });
    }
    for (i = 0; i < demoteList.length; i++) {
        var du = demoteList[i] || {};
        var duUrl = du.originUrl || du.authUrl || '';
        if (!duUrl) continue;
        var decrypted;
        try {
            decrypted = decryptStreamUrl(duUrl, ki.key, ki.iv);
        } catch (e5) {
            continue;
        }
        if (!decrypted || decrypted.toLowerCase().indexOf('http') !== 0) continue;
        if (decrypted.indexOf('_mhd.') >= 0) {
            list.push({ url: decrypted, pri: 1 });
        } else if (decrypted.indexOf('_mud.') >= 0) {
            list.push({ url: decrypted, pri: 2 });
        } else {
            list.push({ url: decrypted, pri: 1 });
        }
    }
    /* 稳定排序，与 py 的 sort(key=lambda x: x[0]) 一致 */
    for (i = 1; i < list.length; i++) {
        var cur = list[i], p = i - 1;
        while (p >= 0 && list[p].pri > cur.pri) {
            list[p + 1] = list[p];
            p--;
        }
        list[p + 1] = cur;
    }
    var out = [];
    for (i = 0; i < list.length; i++) out.push(list[i].url);
    return out;
}

/* py 的可播判定：#EXTM3U 且含 .ts 分片 */
function probe(url) {
    try {
        var body = httpGet(url, baseHeaders());
        return body.indexOf('#EXTM3U') >= 0 && body.indexOf('.ts') >= 0;
    } catch (e) {
        return false;
    }
}

function result(url, key) {
    cjs.setCache(GOOD_KEY + key, url, GOOD_TTL);
    return {
        url: url,
        headers: baseHeaders(),
        referer: REFERER,
        userAgent: UA,
        cookies: browserCookie(),
        title: NAMES[key],
        ttlSec: 60
    };
}

function main(item) {
    var input = item || {};
    var id = pickId(input);
    var key = resolveChannel(id);
    if (!key) throw new Error('未识别的频道: ' + id);

    var last;
    var attempt, i, urls;
    /* 与 py 一致：优先 mbd，逐条探测；失败最多重取 3 次 */
    for (attempt = 0; attempt < 3; attempt++) {
        urls = getM3u8Urls(key);
        for (i = 0; i < urls.length; i++) {
            last = urls[i];
            if (probe(urls[i])) return result(urls[i], key);
        }
    }

    var good = cjs.getCache(GOOD_KEY + key);
    if (good && String(good).length > 10) {
        return result(String(good), key);
    }
    if (last) {
        return result(last, key);
    }
    throw new Error('获取直播流失败（' + NAMES[key] + '）');
}
