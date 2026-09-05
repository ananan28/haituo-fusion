# ChatTranslatorLite v0.5.0 Managed Signal

这是基于用户 v0.4.0 Multi Account 源码进行的 Signal 托管重构。
目标平台：Windows x64。前端和主进程仍使用 Electron + Vite + React + TypeScript。

## 先说明交付状态

完整源码、自动准备运行时的构建脚本、测试和逐文件代码说明均已提供。
TypeScript/Vite 构建、真实本地子进程的模拟核心测试和 DOM 测试已经通过。
当前执行环境未获准完成第三方二进制下载，因此本源码包不含 Signal 核心、Java 二进制或 Windows 安装器。
在可访问 GitHub Releases 的 Windows 构建机运行 BUILD_WINDOWS.bat，会自动下载锁定的核心和 JRE、校验 SHA-256、打包到安装器。下载失败时不会生成缺少组件的安装包。
尚未执行真实 Windows 安装、手机扫码、Signal 收发与真实翻译接口联调。不能将模拟测试结果当作生产发布验收。

## 普通用户的最终使用流程

安装包含完整组件的安装器 → 打开 Signal → 等待二维码 → 用手机扫码确认 → 自动进入会话。
后续再次打开时自动使用独立目录内已有的设备凭据。
新增账号同样自动创建独立端口与目录。没有要求用户复制命令、启动终端、填写端口的界面。
手机扫码确认无法由桌面程序代替。

## 开发和构建

安装 Node.js 22.12+（建议 24），在项目目录：

```text
npm ci
npm run build
npm test
```

Windows 开发运行：

```text
npm run dev
```

predev 会自动准备固定版本的 Windows Signal 核心及 JRE。首次需要下载。

Windows 安装器：

```text
npm run dist:win
```

或直接双击 BUILD_WINDOWS.bat。输出位于 release。
prepare:signal 负责下载和校验；verify:signal 与 electron-builder beforePack 会检查准备结果。
Linux 环境可执行构建及模拟测试；当前资源锁文件针对 Windows x64，不包含 Linux/macOS 运行时。

## 重构结构

- electron/signalBridge.ts：每账号独立子进程、端口分配、就绪检测、自动配对、事件流、有限次数崩溃恢复、退出清理。
- electron/signalStore.ts：独立缓存和 signal-profiles.json 托管配置。
- electron/signalRuntime.ts：只从应用资源目录启动已准备的 Java/Signal 核心，不依赖用户 PATH。
- electron/signalPipeline.ts：主进程接收、存储、去重、限并发翻译、发送与历史记录。
- electron/signalSurface.ts：受控本地聊天页面及消息 ID 级 IPC 校验。
- electron/signalChatPreload.ts：隔离 preload、MutationObserver、textContent 双语气泡。
- src/components/SignalView.tsx：自动连接状态机、中央二维码、联系人与隔离 webview。
- src/components/SignalHub.tsx：多账号管理与 Signal 聚合会话。
- src/components/TranslatePanel.tsx：保留现有翻译接口，修正旧异步结果覆盖和重复发送问题。

## 与旧版数据的关系

保留 appId、应用名、旧 TranGPT 设置、翻译历史和旧 Signal 本地消息缓存。
旧版外置 signal-cli 的加密设备凭据不在 v0.4.0 源码包中；新托管目录不能假装继承这些凭据。
因此升级后旧 Signal 账号需要在新托管服务内用原手机重新扫码一次。
扫码账号与原缓存账号不一致时拒绝混用身份，用户可新增另一个独立账号。
不自动复制正在运行的外部数据库，不删除旧客户端目录，也不自动解绑手机设备。

## 技术边界

这里集成的是 signal-cli 第三方核心服务，不是官方 Signal Desktop 窗口，也不是不存在的官方 Web 聊天站点。
webview 加载的是本项目自有的本地聊天文档。消息由受托管核心通过 JSON-RPC/SSE 提供。
没有解析或修改官方 Signal Desktop 的内部数据库或 DOM。
后台收到消息时主进程会主动翻译；聊天页面的 MutationObserver 请求复用同一条去重管线，避免历史补译和实时翻译重复计费。
所有翻译仍通过原 TranGPT 接口；启用翻译意味着原文会提交给该接口。
不承诺语音/视频、完整媒体预览或恢复全部手机历史与官方客户端完全一致。
每账号当前保留 4000 条本地消息，显示最近 500 条；打开会话最多补译最近 6 条未翻译收到的文字。

## 源码与许可证

逐文件完整代码见 SIGNAL_REFACTOR_FULL_CODE.md。
第三方来源、版本及许可说明见 THIRD_PARTY_NOTES.md。
测试范围与未验证事项见 VALIDATION.md。
