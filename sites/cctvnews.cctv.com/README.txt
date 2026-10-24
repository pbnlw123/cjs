央视新闻 CCTV 直播 —— CJS 插件（酷9 / NTV）
==========================================

入口
----
CJS 链接：https://litter.catbox.moe/rgzh31.cjs?id=cctv13
站点目录：https://litter.catbox.moe/pngrvg.json

频道（?id=）
------------
cctv1 / cctv2 / cctv4 / cctv7 / cctv9 / cctv10 / cctv12 / cctv13 / cctv17 / cctv4k
也接受 CCTV-13 这类写法、roomId 数字，以及完整页面地址
https://m-live.cctvnews.cctv.com/live/landscape.html?liveRoomNumber=<roomId>

频道页
------
site.json / catalog / .cjs 里的 playback.page 用的是央视新闻移动端直播页：
  https://m-live.cctvnews.cctv.com/live/landscape.html?liveRoomNumber={id}
hosts 里包含 m-live.cctvnews.cctv.com、live-play-hls.cctvnews.cctv.com、
tv.cctv.com、cctvnews.cctv.com、www.cctv.com。
请求头的 Referer / Origin 也统一用 https://m-live.cctvnews.cctv.com/，
和 py 脚本里的 HDR 完全一致。

实现
----
1. 网关签名：GET gateway2.cctvnews.cctv.com/1.0.0/feed/article/live/detail
   x-ca-signature = Base64(HMAC-SHA256(secret, 拼好的签名字符串))，用运行时内置 CryptoJS。
2. 解密：authUrl 为 AES-128-CBC，key = dk[:8] + 秒级时间戳[-8:]，iv = dk[-8:] + 秒级时间戳[:8]，
   用 cjs.opensslDecrypt 解出 https 播放地址。
3. 多码流：mbd（默认）/ mhd / mud，quality=high|medium|low 切换；返回前先自拉一次播放列表，
   没有 #EXTINF 就换下一跳，最多重取 3 次。
4. 浏览器会话：UA、Referer、Origin + 随机浏览器 Cookie（client_id / p_h5_u / _bl_uid，缓存 24h），
   返回值里同时下发 headers / referer / userAgent / cookies。

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

验证（2026-10-24）
------------------
- 4 种入口全部解析成功：?id=cctv13 / ?id=<roomId> / 完整 landscape 页面地址 / CCTV-4K
- 播放列表 200 且含 #EXTINF，分片 1.9MB 级
- 模拟安装：.cjs 0.9~5.5s（catbox 抖动）/ manifest 0.9s / runtime 1.2s / .so 2.5s，
  全部低于播放器 8s 与 30s 下载上限；sha256 与 ELF ARM64(e_machine=183) 校验通过
- .so 复用官方 arm64 模块（1.1MB）。catbox 单线程约 13KB/s，86s 必超 30s 上限，
  所以 .so 放在 uguu（约 3 小时有效），过期后找我重传；JSON/脚本仍走 catbox，保留 72 小时。
