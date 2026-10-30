# Viber 多开启动器（macOS）

一个原生 GUI 小窗口：默认内置 16 个账号槽位，可自定义数量、勾选（多选/全选）批量启动与删除、每行可写备注、可选「自动保持运行」。

## 安装

1. 到 Actions 的 `Viber multi-account launcher build` 最近一次成功运行，下载 artifact **`ViberLauncher-dmg`**，解压得到 `ViberLauncher.dmg`。
2. 双击挂载，把 `ViberLauncher.app` 拖进 `Applications`。
3. 首次打开若被 Gatekeeper 拦截（ad-hoc 签名，无公证）：右键 → 打开；或执行
   ```bash
   xattr -dr com.apple.quarantine /Applications/ViberLauncher.app
   ```
4. 前提：本机已安装 Viber（`/Applications/Viber.app` 或 `~/Applications/Viber.app`）。

## 界面怎么用

顶部一行：

| 控件 | 作用 |
|---|---|
| `数量` 输入框 + `按数量启动` | 输入 4 → 生成/裁剪到 4 个槽位并立即全部启动（多余的先停止再移除） |
| `仅生成` | 只把槽位数调到 N，不启动 |
| `自动保持运行` | 打开后（默认开），已启动的实例被关掉会在 3 秒内自动拉起；单行点「停止」会取消该账号的保持 |
| `全选` / `全不选` | 批量勾选 |

列表每行：勾选框、账号名、备注、状态灯、启动/停止。

底部操作栏：`启动所选(N)`、`全部启动`、`停止所选`、`全部停止`、`删除所选`、`全部删除`、`数据目录`。

- 「多选」= 先在行首勾选多个，再点 `启动所选` / `删除所选`。
- 「全选启动」= `全选` → `启动所选`；「全选删除」= `全选` → `删除所选`。
- 删除只从列表移除并停止进程，**不删数据**；要清数据请去 `数据目录` 手动删 `profiles/<id>`。

## 数据放在哪

```
~/ViberMulti/
├── accounts.json          # 数量、自动保持开关、每个账号的名称/备注/勾选/是否应保持运行
├── profiles/<账号id>/     # 该账号的 HOME（Viber 的 profile 都在这里）
│   └── .pid               # 该实例的进程号，用来判断存活
└── tmp/<账号id>/          # 该账号的 TMPDIR（单实例守卫 socket 落在这里）
```

## 它到底做了什么

每个账号启动时直启 `/Applications/Viber.app/Contents/MacOS/Viber`，并注入：

```
HOME=~/ViberMulti/profiles/<id>
CFFIXED_USER_HOME=~/ViberMulti/profiles/<id>
TMPDIR=~/ViberMulti/tmp/<id>/
```

与探针里验证过的机制一致（见 [docs/macos-viber-isolation.md](../docs/macos-viber-isolation.md)）：

- `TMPDIR` 是绕开 QtSingleApplication 单实例守卫的开关（守卫 socket 在 `$TMPDIR/Viber-0-1f5`）；
- `HOME` + `CFFIXED_USER_HOME` 让 profile、缓存、HTTPStorages 落到各自目录；
- 必须直启可执行文件：`open -a` 带不了环境变量，`open -n` 的第二个进程会消失。

## 已知边界

- 残留共享面：`~/Library/Preferences/com.viber.osx.plist`（实测只有 App Center 分析 ID 和状态栏图标显隐，无账号数据）。多实例会共用它。
- 状态灯靠 pid 文件 + `kill(pid,0)` 判断，不校验进程身份；进程被系统回收后最多 3 秒纠正。
- 只在 GitHub macOS runner 上用**合成/未登录**实例验证过「能开、profile 分开」；真实账号的登录、消息收发、通话、封号都**未验证**。
- 没有真机 Apple Silicon 的实测数据。runner 上 16 实例约 216 MB/实例、共 3.46 GB（7.5 GB 内存）；首次冷启动（Rosetta 首次翻译）可能 200–390 秒，热态约 5 秒。
- 未做公证（Notarization），分发给自己用没问题，给别人会被 Gatekeeper 拦。

## 自己编译

```bash
cd launcher
./build.sh     # 需要 Xcode 或 Command Line Tools 的 swiftc + hdiutil
open build/ViberLauncher.app
```
