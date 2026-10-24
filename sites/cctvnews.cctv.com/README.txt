央视新闻 CCTV 直播 —— CJS 插件（酷9 / NTV）v3
=============================================

入口（推荐直接把这行加进直播源）
--------------------------------
https://litter.catbox.moe/uas9ts.cjs?id=cctv13

站点目录（catalog）：https://litter.catbox.moe/tdsvi4.json

链路（App 安装时实际下载的四个文件）
----------------------------------
.cjs      https://litter.catbox.moe/uas9ts.cjs
manifest  https://litter.catbox.moe/uzeuma.json
runtime   https://litter.catbox.moe/dri57t.json
native    https://litter.catbox.moe/pq961x.so     2328 字节，ARM64 ELF

频道（?id=）
------------
cctv1 / cctv2 / cctv4 / cctv7 / cctv9 / cctv10 / cctv12 / cctv13 / cctv17 / cctv4k
也接受 CCTV-13 这类写法、roomId 数字，以及完整页面地址
https://m-live.cctvnews.cctv.com/live/landscape.html?liveRoomNumber=<roomId>

频道页
------
playback.page 用央视新闻移动端直播页：
  https://m-live.cctvnews.cctv.com/live/landscape.html?liveRoomNumber={id}
hosts 含 m-live.cctvnews.cctv.com / live-play-hls.cctvnews.cctv.com /
tv.cctv.com / cctvnews.cctv.com / www.cctv.com。
请求头 Referer、Origin 统一用 https://m-live.cctvnews.cctv.com/。

与 cctvnews.py 的逐项对应
--------------------------
| py                                | 本插件                                  |
| _create_uuid() 32 位无连字符       | createUuid() 同格式（cookieuid/userid/  |
|                                   | x-request-id 全用它）                    |
| uuid.uuid4() 带连字符，仅 p_h5_u   | uuid4() 同格式                          |
| _gen_browser_cookie() 进程内一次   | cjs.setCache 缓存 24h，取回即复用        |
| HDR（UA/Referer/Origin/Accept/    | baseHeaders() 同字段，Cookie 也一起下发  |
| Accept-Language/Cookie）          | 到播放器 headers / referer / userAgent / |
|                                   | cookies                                 |
| _sign_request()                   | signRequest()，HMAC-SHA256 → Base64     |
| _get_key_iv()                     | getKeyIv()，key=dk[:8]+ts[-8:]          |
|                                   | iv=dk[-8:]+ts[:8]                       |
| _aes_decrypt_b64()                | cjs.opensslDecrypt('AES-128-CBC',0,iv)  |
| _get_m3u8_urls() 优先级 0/1/1/2    | getM3u8Urls() 同优先级 + 稳定排序        |
| _refresh_url() #EXTM3U 且含 .ts    | probe() 同判定                          |
| _last_good_m3u8 30 秒保底          | cjs.setCache(cctvnews_good_*) 30 秒     |

实现说明
--------
py 版本额外跑了一个 9990 端口的本地代理来重写 m3u8 分片地址；CJS 插件不能起端口，
所以直接返回 CDN 的 https 播放地址。酷9 自带 HlsProxyServer 会解析 m3u8 里的
相对分片路径（R0.e: uri.resolve），并把 referer / UA / cookie 带到每次分片请求上，
效果与 py 代理一致。

包结构
------
sites/cctvnews.cctv.com/main.js
sites/cctvnews.cctv.com/site.json
sites/cctvnews.cctv.com/plugin.json
sites/cctvnews.cctv.com/version.cjs
sites/cctvnews.cctv.com/dist/runtime.json
sites/cctvnews.cctv.com/dist/arm64-v8a/cctvnews.so
cctvnews.cjs
catalog.json

验证（2026-10-24 v3）
--------------------
- 5 种入口全部拿到 mbd 播放列表：?id=cctv13 / ?id=<roomId> / 完整 landscape 页面 /
  CCTV-4K / quality=low；单次解析 0.5~0.7s
- .cjs 0.87s / manifest 0.85s / runtime 0.90s / .so 0.72s，均远低于 8s、30s 上限
- sha256 全部匹配；.so 通过 E0.M() 校验（7F 45 4C 46 / class64 / e_machine=183）
- 200 秒连续播放模拟：播放列表每 4s 刷新一次，分片连续落盘，0 失败
- 分片直连测试：带 Cookie / 无 Cookie / 仅 UA 三种组合均 200，单分片 1.7~1.9MB

注意
----
- 之前 v2 的 native 文件放在 uguu，几小时后过期变 404，安装会直接报
  "站点插件解析失败"。v3 换成 2328 字节的占位 ARM64 模块（只用于通过安装校验，
  本站点不调用 native），litterbox 托管，下载 0.7s，不会再超时。
- litterbox 文件保留 72 小时，过期后重跑 build.py 重新生成即可。
