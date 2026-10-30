# 海拓 1.6.7 — WhatsApp 启动恢复修复候选

基线为 1.6.6 / 96b777e，保留 Signal 子账号媒体修复。不混入 fusion/develop 或 Viber 实验；老仓库只读，本次仅在 haituo-fusion 的独立修复分支构建。

## 已确认的代码缺陷

1. 旧启动器仅在 did-finish-load 中移除错误遮罩；若预加载就绪消息晚到，虽然取消计时器，遮罩仍留在页面上。
2. 旧门槛依赖所有子资源结束的 did-finish-load，并在 12 秒判失败。已可交互的页面会因慢图片等尾部资源被错误遮挡。
3. 预加载握手只发一次；快速启动/导航生命周期的时序差异缺少补握手机制。
4. WhatsApp 同时注册 bootstrap 与通用 network recovery，空白/崩溃后有两个恢复所有者。
5. 全局 render-process-gone 把 WhatsApp 子视图崩溃当作整个应用的致命错误，弹框后退出，阻断子视图恢复。

## 修复

就绪检查对事件顺序对称，在预加载与 DOM 就绪时清除旧遮罩；dom-ready 发起补握手。预加载响应补握手，并在 DOMContentLoaded/pageshow 重报就绪（只上报状态和文档 URL）。不再等全部资源下载完才判可用。启动观察窗口调整为 45 秒；空白、初始瞬时网络故障、崩溃采用单一恢复所有者，自动尝试最多两次并退避。忽略子资源失败和 ERR_ABORTED，不因可用页面的瞬时网络故障主动刷新。SSL 证书错误不绕过、不自动重试。全局错误处理仅对已由 WhatsApp 启动器管理的 guest 交由隔离恢复；Signal 和主窗口仍保留原有致命错误处理。销毁时取消恢复任务。错误界面去除面向开发者的固定端口提示。

未升级 Electron/Chromium 二进制，截图不足以证明浏览器引擎本身损坏。未修改 Signal 核心消息、数据库、媒体修复或 WhatsApp 翻译/回贴逻辑；不清理 Cookie、登录会话、数据库、API 密钥。

## 验证

本地 node 单元测试结果以最终日志为准，新增 WhatsApp guest 崩溃与主窗口/Signal 致命错误的隔离测试。原生离线测试使用正式 will-attach/preload/sandbox 路径，在 Windows/macOS 启动 6 个独立分区，覆盖慢资源、3 轮共 18 次刷新、单个 guest 崩溃恢复与账号隔离；结果以本次 Actions 记录为准，未完成前不得写成通过。

真实 WhatsApp 服务与已登录账号运行仍需用户本机复验；合成页面测试不等于真实账号验收。
