# 1.6.4 子 Signal 默认融合

正常安装、双击打开即可。Windows 和 macOS 都不需要 `--haituo-inprocess`。

子账号界面为主窗口内的 WebContentsView，协议、数据库和浏览器分区仍隔离，后台仍有独立进程。旧快捷方式上的 `--haituo-inprocess` 可以删去，保留也兼容。

只有排查问题时，完全退出后使用 `--haituo-legacy-windows` 或环境变量 `HAITUO_INPROCESS=0` 才使用旧窗口方式。不推荐日常使用旧方式。

Windows 用户已反馈 1.6.2 在开启融合后拖动无感、不偏移；此反馈不代表所有电脑和 Mac 的全部操作均已验收。
