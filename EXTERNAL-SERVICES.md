# 外部依赖

本工程可独立修改并构建海拓客户端，不需要旧海拓仓库。首次构建从固定版本的官方 npm 发布包取得 Electron、构建工具和平台原生依赖，并校验原生包发布校验和。

运行 WhatsApp、Signal 需要连接其第三方服务；翻译和转写需要所选服务商及用户自行配置的 API 密钥。当前主进程使用系统网络/代理，不把翻译池代理设置到聊天会话。

源码保留 https://ffnvtyadqizvrikjjssy.supabase.co/functions/v1/username-login 调用端；该私有后端源码未取得。当前树中未包含 backend/，也没有可完整重建翻译池管理网站的前端和数据库迁移。旧版文件说明与当前树不符之处已在 START-HERE.md 更正。

不附带个人密钥、用户数据库、会话或签名证书。随附第三方许可保留在原文件中。macOS 采用本地 ad-hoc 签名，Windows 未提供付费发布签名证书。
