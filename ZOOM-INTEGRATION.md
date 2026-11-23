# Zoom Google 登录修复（1.7.2fix 后续）

症状：39fdf44 把 Google 授权页留在 Zoom 面板后，真实账号仍看到 Windows 通行密钥弹窗和「此浏览器或应用不安全」，无法登录。

根因：Google 明确禁止 OAuth 在嵌入式 WebView 中运行。39fdf44 只去掉了 UA 里的 Electron 标记，但授权页仍位于 Electron `<webview>` guest 中；把 UA 改成 Chrome 字符串不能改变这个嵌入环境。Zoom 官方开发论坛也确认 Google 不接受 embedded user agent 的授权请求。

改动：
- `src/app/js/haituo-zoom-security.js`：身份源导航不再进入 Zoom webview，而是打开海拓自己的顶层 `BrowserWindow`。该窗口复用同一个 `persist:caisheng-zoom-*` 分区，保留 sandbox/contextIsolation、禁用 Node；授权回到 `zoom.us` 且页面加载完成后，再自动关闭登录窗并刷新原 Zoom 面板。身份源及企业 SSO 的后续跳转绑定首个身份 origin，子窗口继承同一策略与回传监听。
- 主窗口拦截与 `window.open` 两条入口都走同一登录窗，Zoom 子窗也递归安装弹窗守卫；Zoom 入口直达 `https://zoom.us/signin#/login`，避免 `meeting/login` 在部分平台只落到登录外壳。非身份源链接仍按原策略处理。日志只记录 origin+pathname，不记录 OAuth query/state/code。
- Zoom 会话同时规范 User-Agent 与低熵 User-Agent Client Hints，清除请求头中的 Electron 品牌；身份源请求不被会话头逻辑二次覆盖。登录窗及子窗在首次导航前等待 CDP `Emulation.setUserAgentOverride` 完成，再同步 JS 可见的 `navigator.userAgentData` 品牌、完整版本、平台与架构，并使用标准 Chrome 简化版本号，避免只改请求头却仍向页面暴露 Chromium-only 元数据。不读取或输出 Cookie/Authorization。
- 企业 SSO 从 `zoom.us/web/sso/login` 进入时开启 120 秒一跳窗口，只允许首个客户 IdP origin，回到 Zoom 即失效。
- `scripts/zoom-shell-native-check.cjs` 增加真实产品壳验收：用受信任指针点击 Google，断言授权页是新的顶层 page 目标、guest 仍停在 Zoom、UA 不含应用标记，并直接拒绝「浏览器或应用不安全」页面。登录窗加载失败后保留至 10 分钟超时，使 Windows/macOS 都能附着失败目标；诊断先启用 Network，再用 Google 首页/账号页隔离导航故障并读取 JS 可见 UA metadata，从导航历史恢复原 Google 授权 URL 重试，记录不含凭证的文档请求/响应、UA/UA-CH/Sec-Fetch 白名单请求头及加载失败码。另以 10 秒墙钟预算、无 Cookie/Authorization 的 Node 直连探针记录 runner 出口状态，不把出口失败误判为 Electron 独有。报告、stdout 与原始应用日志统一去除 URL query/hash，修复 JSON replacer 误把 key 当 value 而输出空字符串的问题。脚本后的 Zoom 回跳只验证关窗与面板恢复代码路径，明确标记为 synthetic，不冒充真实 OAuth；没有真实账号，因此仍只验证到凭据页之前。

尚未验证：真实 Google 账号输密码/验证码/通行密钥、拿到 code 后回到 Zoom 并显示已登录，以及会议音视频、屏幕共享、真实聊天与字幕选择器。顶层窗口是否被 Google 接受必须以 Windows/macOS 远端产品壳测试结果为准，不能只看 URL 跳转成功。

# 1.7.1 Zoom 启动修复

1.7.0 真机黑屏由主窗口函数局部变量 m 遮蔽 node:fs 引起：m.statSync 不是函数，guest 创建中断。现改用显式 require(node:fs)，异常记录并拦截；测试故意提供非 fs 的 m，避免桩掩盖作用域问题。

新增真实产品壳运行测试：Windows 走新增账号按钮，macOS 走持久账号恢复（原生菜单另做静态检查）；真实 Zoom 未登录页通过与否以 audit-results/zoom-shell.json 为准，不代表真实账号、个人聊天或会议通过。撤回新增的主界面加载覆盖层；验收直接检查真实页面可见、无遮挡。补齐 macOS 原生新增菜单。

# Zoom 接入：1.7.0 诊断开发分支

基线为海拓 1.6.9（acba10a），保留其回译开关、截图、WhatsApp 启动与右键修复。独立分支 feature/zoom-1.7.0，不覆盖稳定安装包、fusion/develop 或老仓库。

## 已实现的代码路径

- “+”菜单新增 Zoom 账号；每账号使用 persist:caisheng-zoom-<id> 独立会话，支持同一窗口切换，使用 Zoom 官方 Web App 的联系人聊天与会议页面。
- 默认自动翻译可识别的聊天消息，在原文下显示译文；复用当前聊天翻译模型与主备调度，不要求另填一套 API。
- 接收、发送和群组回译开关沿用海拓设置；禁用后隐藏对应译文、停止新任务，旧结果不能绕过开关。
- 只处理聊天列表中的消息，不扫描登录表单；只处理屏幕内消息，每账号并发最多 2、待处理最多 200、会话内 LRU 最多 500，重建行命中缓存不重复请求。
- 中文输入按 Enter 先翻译填入、显示回译，确认后再发送；默认禁止直接中文发送保留。Zoom 实际输入框/发送按钮选择器仍须真账号核实，不提前保证所有输入路径。
- 会议读取已经显示的文字字幕，并在原字幕下翻译；不自动打开字幕、不捕获会议声音、不启动录音。主持人未提供字幕时不能据此声称具备音频实时翻译。
- 麦克风、摄像头明确请求确认；屏幕共享使用系统选择器，回退时明确选择来源，可取消，不自动共享全部屏幕或系统音频。
- 只允许 HTTPS Zoom 服务域；保留 sandbox/contextIsolation，禁用 Node；不去除 CSP/证书验证，不接入未知个人更新服务。

## 验证边界

本地合成 DOM 已验证默认自动翻译、原文下贴附、禁用/恢复、晚到结果、账号隔离、虚拟行重建、登录表单隔离、输入翻译与字幕示例。权限策略单测覆盖伪造域、无手势、拒绝/允许与共享取消。

实际 Zoom 登录、真正聊天页面选择器、输入框受控编辑行为、跨账号真实收发、会议音视频/共享、真实字幕、Google/企业 SSO 登录均 UNTESTED。没有测试账号和具体会议链接，不能将合成数据通过称为以上通过。

此诊断版用于用户本机登录专用账号后核对，不宣称已经达到 WhatsApp 的真实账号兼容程度。若 Zoom DOM 不匹配，显示“等待可识别的聊天消息”，不能写成翻译成功。所有平台既有功能也需回归，不发布到下载网站。

## 自检与构建

python3 scripts/apply-zoom.py
node --test scripts/zoom.test.cjs scripts/wa-attach-handler.test.cjs
HAITUO_QA_NODE_MODULES=/path/to/node_modules node --test scripts/zoom.dom.cjs
python3 scripts/build.py --target windows
python3 scripts/build.py --target macos

Zoom 官方 Web App：https://app.zoom.us/wc/home
官方说明：https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064261

首次登录需要用户自行操作；不收取用户密码或验证码。不自动加入任何未授权会议。
