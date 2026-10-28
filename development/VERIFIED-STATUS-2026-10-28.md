# 四服务融合：已验证状态（2026-10-28）

集成提交：56b01b45d5bca23996c4c620fd4ff97025179eb7，分支 fusion/develop。main 保持 96b777e9158851560325a7e6aca16a27a5ce1661。老仓库只读；冻结基线 5fcd99a3b31b2dd9b1eb3ba97d69a4bff29e112b 未修改。没有发布 Release，未改版本号、许可和签名配置。

## 独立开发与集成

|服务|独立分支|本轮实现|
|---|---|---|
|Viber|fusion/viber、fusion/viber-shell|连接代次、统一失效清理、迟到首帧拦截、几何失败恢复；macOS 主壳内原生多账号画面、AX 点击、OCR、共享翻译、原文/译文填入及源退出恢复|
|WhatsApp|fusion/whatsapp|翻译及 AI 重试按会话、消息、文本、目标语言和当前节点校验，防止迟到结果串入新聊天|
|Signal|fusion/signal|子账号媒体断开监听的释放、关闭状态与幂等处理，保留 1.6.6 媒体修复|
|Telegram|fusion/telegram|消息标识增加会话/路由作用域，处理嵌套消息标识与节点复用，拦截切聊天后的迟到翻译；默认翻译关闭不变|

## 可复核验证

- 最新完整构建和集成验证：https://github.com/ananan28/haituo-fusion/actions/runs/40637186709 。source、macos-15、windows-2025、real-unlinked-viber 四个任务全部成功，验证 source 输出的 cae227c1c9ce3a265454873b27449e9f9460b914（已合入上述集成提交）。
- macOS 实际安装包：合成图像→本机 OCR→本地合成翻译→填入；验证账号切换清图、过期 OCR/翻译拦截及中文发送策略。没有自动发送。
- macOS 官方未登录 Viber：五个独立实例、15 次切换、真实 AX 点击、源窗口层级和包含关系、源进程退出清图并重连。仅上传状态元数据，不上传帧或聊天内容。
- Viber AppKit 内存状态与合成图像回归包含旧流晚停、迟到帧、几何失败、首帧恢复和流错误代次隔离。编译/运行命令见 viber-fusion/STATE-REGRESSION.md，运行环境 macos-15。
- Windows/macOS 打包、原生数据库与首次启动/设置/重启检查在 Actions 执行。没有在用户电脑构建。

## 验收边界与未完成项

- Viber 原生主壳融合目前为 macOS；其余三服务沿用 Web 多账号架构。Windows Viber 隔离实验 fusion/viber-windows 仅为调查，不是可用产品：官方第二实例被单实例机制阻止，未开启 Windows Viber 菜单。
- 原型 800×600 的原有断言保留。该尺寸出现真实几何失败后安全清理并最小化源窗，窗口断言报 TARGET_WINDOW_UNAVAILABLE；不声明小尺寸通过，不增加宿主最小尺寸。
- 17 个历史驻留聊天模式 DOM 失败保留，未归入当前功能门禁；不声明整个历史测试集合全绿。
- 尚未使用真实登录聊天进行端到端验收，不请求或上传真实聊天与真实用户文件。当前证据由合成数据与未登录官方客户端构成。
- 未实现 contentRect、滚动/IME；保留原约束范围。
