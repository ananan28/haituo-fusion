# 1.7.2 Zoom 登录内嵌与打开速度

症状：Zoom 面板打开慢；点「Google/Apple/Facebook/SSO」登录后页面被甩到系统浏览器；在浏览器里登录完，海拓的 Zoom 面板仍是未登录。

根因（实测，非推断）：Zoom 登录页的第三方按钮走同一框架的主文档跳转，CDP 目标 id 在跳转前后一致（zoom-login-fix/result.json 的 popupSameTargetAsGuest=true）。1.7.1 的 installNavigation 对所有非 zoom.us 主文档导航一律 preventDefault 并交给系统浏览器，因此 accounts.google.com 永远进不了面板；OAuth 的 code 也就落不到面板所在的 persist:caisheng-zoom-* 会话里，表现为「登录后海拓没反应」。

改动：
- src/app/js/haituo-zoom-security.js：新增身份源白名单 isIdentityURL（accounts.google.com、appleid.apple.com/id.apple.com、login.microsoftonline.com/login.live.com、facebook.com）与 120 秒企业 SSO「一跳」窗口——只有从身份源出发、且尚未回到 zoom.us 期间的 HTTPS 主文档导航才留在面板内，回到 zoom.us 立即失效；其余链接仍按原策略送系统浏览器。子窗口通过 did-create-window 继承同一守卫。每个决策写日志（haituo: Zoom window.open in-app/external、Zoom identity hand-off kept in Haituo、Zoom SSO hop kept in Haituo、Zoom link sent to system browser）。
- scripts/zoom-patch.json：主窗口 setWindowOpenHandler 对 Zoom/身份源 URL 返回 action:'allow' 并沿用 guest.session.partition，其余仍 openExternal；zoom 平台 startUrl 由 https://app.zoom.us/wc/home 改为 https://zoom.us/meeting/login。
- src/app/js/haituo-network.js：installWebRecovery 的 did-fail-load 主机白名单原本只有 web.whatsapp.com 与 web.telegram.org，Zoom 首屏加载失败从不重试；现加入 zoom.us 及其子域。
- src/app/js/haituo-zoom-adapter.js：非 Zoom 域不再把 caisheng:get-translation-config 的拒绝原文刷在面板上（面板首帧在 about:blank 与身份源页运行，属预期拒绝），改显示「等待 Zoom 页面…」。

实测数字（本机一次性副本应用，独立临时 profile，合成操作，不含真实账号）：
- 出登录表单：旧入口 app.zoom.us/wc/home 54.2 秒，且未登录时先显示「下载Zoom应用」再自跳 zoom.us/signup?from=zwa（该页只渲染 Cookie 横幅，普通浏览器同样如此）；新入口 zoom.us/meeting/login 两次分别 7.7 秒与 28.5 秒。
- 五个第三方按钮逐个用真实指针序列（Input.dispatchMouseEvent 的 mouseMoved→mousePressed→mouseReleased）点击，每次都先弹回登录页再点下一个，全部在面板内落地、没有调用系统浏览器（zoom-ms-sso/result.json）：Microsoft 1.45 秒 → login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=https://zoom.us/mi…；SSO 0.91 秒 → zoom.us/web/sso/login?en=signin；Google 1.27 秒 → accounts.google.com/v3/signin/identifier；Facebook 1.56 秒 → www.facebook.com/login.php?app_id=113289095462482；Apple 2.48 秒 → appleid.apple.com/auth/authorize?redirect_uri=https://zoom.us/apple/oauth。主进程日志逐条对应「Zoom identity hand-off kept in Haituo」，Google/Facebook 各两条（authorize 与最终标识页）。日志里的「Zoom returned to Zoom from the identity hop」是测试脚本把面板弹回登录页时触发的，只证明回到 zoom.us 会清掉一跳窗口，不等于真实 SSO 回跳；SSO 按钮本身落在 zoom.us/web/sso/login，走的是 zoom.us 白名单而不是一跳窗口。
- Google 页正文含「继续前往Zoom」，redirect_uri=https://zoom.us/google/oauth；同一 CDP 目标 id 证明它留在原面板内。
- 测试口径：Zoom 登录页的按钮用脚本 `.click()` 不生效（第一轮 zoom-providers 因此把 Apple/Microsoft 误报成「still on zoom.us」），必须用受信任的指针事件；验收以 URL+日志为准，面板内容不出现在壳层 CDP 截图里（webview 目标截图会超时）。
- 登录页静置 8 秒，guest 的 ScriptDuration 增量 149 毫秒（约 1.9% 单核），说明自动翻译面板不是打开慢的主因。
- scripts/zoom.test.cjs 增加 4 条（身份源识别、主文档留在应用内、SSO 一跳到期即失效、子窗口继承守卫），本机 node --test 10/10 通过；旧 6 条未改动。

仍未验证：没有真实 Zoom 账号，五家身份源都只走到输入凭据前的那一页，**整条登录链路（拿到 code 后回到面板并显示已登录）尚未跑通验证**；一跳窗口的真实到期、企业 SSO 的域名跳转、Apple 弹窗式授权、会议音视频、屏幕共享、真实聊天与字幕选择器仍为 UNTESTED。

构建注意：apply-zoom.py 的幂等判定只认「未打补丁的基准」或「已物化成最终形态」两种输入。若为已物化的块再追加一条 refinement 补丁，早先那条补丁的 final 判定会失配并二次插入，导致锚点漂移。因此本次直接改写拥有该锚点的原条目，再从 acba10a 基准重新物化两个 bundle，二次运行为 no-op 已验证。

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
