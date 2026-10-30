# Viber 多开启动器（macOS）

一个原生小窗口，按账号一行：勾选框、账号名、备注、运行状态灯、启动/停止。支持「启动所选」「全部停止」「添加账号」。

## 用法

1. 从 Actions 的 `Viber multi-account launcher build` 里下载 artifact `ViberLauncher`，解压得到 `ViberLauncher.app`。
2. 若 Gatekeeper 拦住（ad-hoc 签名），右键 → 打开，或在终端执行：
   ```bash
   xattr -dr com.apple.quarantine /path/to/ViberLauncher.app
   ```
3. 双击启动。首次打开会自动建 4 个账号（账号 1–4）。

## 数据放在哪

```
~/ViberMulti/
├── accounts.json          # 账号名、备注、勾选状态
├── profiles/<账号id>/     # 该账号的 HOME（Viber 数据都在这）
└── tmp/<账号id>/          # 该账号的 TMPDIR
```

- 删掉 `profiles/<id>` 即可清掉该账号的数据；窗口里点「删除」只是从列表移除并停止进程，不删数据。
- 启动时会读取 `/Applications/Viber.app`；不在该路径时会尝试 `~/Applications/Viber.app`，找不到会在底部红字提示。

## 它到底做了什么

每个账号启动时执行一次：

```
HOME=~/ViberMulti/profiles/<id>
CFFIXED_USER_HOME=~/ViberMulti/profiles/<id>
TMPDIR=~/ViberMulti/tmp/<id>/
/Applications/Viber.app/Contents/MacOS/Viber
```

这与探针里验证过的机制完全一致（见 [docs/macos-viber-isolation.md](../docs/macos-viber-isolation.md)）：

- `TMPDIR` 是绕开 QtSingleApplication 单实例守卫的开关（守卫 socket 在 `$TMPDIR/Viber-0-1f5`）；
- `HOME` + `CFFIXED_USER_HOME` 让 profile、缓存、HTTPStorages 落到各自目录；
- 必须直启可执行文件，`open -a` 无法携带环境变量。

## 已知边界

- 残留共享面：`~/Library/Preferences/com.viber.osx.plist`（只有 App Center 分析 ID 和状态栏图标显隐，无账号数据）。
- 状态灯靠 pid 文件判断进程存活，不校验进程身份；应用崩溃后可能短暂显示为运行中，2 秒后自动纠正。
- 只在本机的实测环境验证了「多实例能开、profile 分开」；登录账号后的消息收发、通话、封号均未验证。
- 首次冷启动（新装 + Rosetta 首次翻译）可能 200–390 秒才出窗口，之后热态约 5 秒。

## 自己编译

```bash
cd launcher
./build.sh          # 需要 Xcode 或 Command Line Tools 里的 swiftc
open build/ViberLauncher.app
```
