# Zoom 登录修复（1.7.2fix 后续）

症状：39fdf44 把 Google 授权页留在 Zoom 面板后，真实账号仍看到 Windows 通行密钥弹窗和「此浏览器或应用不安全」，无法登录。

结论：Google 官方禁止嵌入式 WebView OAuth，桌面应用应使用系统浏览器；Electron 的顶层 `BrowserWindow` 仍是由应用托管的嵌入式 Chromium，不会因为不在 `<webview>` 标签里就变成受支持的外部浏览器。远端 1a5bd8e 已记录 Node 直连 Google 返回 302、Electron 在取得 HTTP 响应前返回 `ERR_ACCESS_DENIED`；后者本身不能证明就是 Google 的 HTTP 拒绝，但足以否定“改成顶层窗口就已修好”。b0d6f6d 的 UA/CDP 伪装没有进入真实壳测试，且不属于受支持方案，已停止。

改动：
- 移除第三方 OAuth `BrowserWindow`、CDP UA metadata 伪装和失败登录窗诊断路径，不再把隐藏 Electron 身份当作登录手段。
- Google、Apple、Facebook、微软身份源的主框架导航和 `window.open` 都被拦截在海拓内，弹出明确提示并引导用户使用 Zoom 官方邮箱登录；选择“使用邮箱登录”只聚焦页面邮箱框，不读取、保存或提交密码，也不打开系统浏览器。
- 企业 SSO 仍保留从 `zoom.us/web/sso/login` 开始的 120 秒、单 origin 受限跳转；非身份源普通链接仍按原外部浏览器策略处理。
- Zoom 自身请求继续规范 UA/UA-CH；身份源请求不再被会话头逻辑改写。日志只记录 origin+pathname，不记录 OAuth query/state/code。
- `scripts/zoom-shell-native-check.cjs` 的真实产品壳门槛改为：Windows 走新增账号按钮、macOS 走持久账号恢复，确认真实 Zoom 登录页可见且无遮挡，用保留域 `example.com` 的合成邮箱走到 Zoom 密码步骤。脚本不输入密码、不点击第三方登录、不创建 Google 授权页；报告明确记录 `realAccount: UNTESTED` 和 `EMBEDDED_OAUTH_UNSUPPORTED`，不把合成邮箱通过冒充真实账号登录完成。

尚未验证：真实邮箱密码、验证码、通行密钥、Google/Apple/Facebook/微软 OAuth、OAuth code 回到 Zoom 后显示已登录，以及会议音视频、屏幕共享、真实聊天与字幕选择器。纯社交账号可按 Zoom 官方流程补设密码后再使用邮箱登录。Google 官方桌面 OAuth 文档：https://developers.google.com/identity/protocols/oauth2/native-app ；Zoom 登录与浏览器要求：https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0067781 、https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0058323 。

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
