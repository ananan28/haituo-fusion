# macOS 上隔离多个 Viber 实例 — 实测结论

**结论（一句话）**：macOS 单个用户会话内**可以多开，而且不止两个**——Viber 的单实例守卫是 QtSingleApplication 在用户临时目录 `$TMPDIR` 下的一个 Unix socket（`Viber-0-1f5`）加一个锁文件（`qtsingleapp-Viber-0-1f5-lockfile`）；给每个实例注入独立的 `TMPDIR` + `HOME` + `CFFIXED_USER_HOME` 后直启，实测**同一台 runner 上 16 个实例同时出窗口、各自写自己的 profile**（单实例约 216 MB RSS）。唯一残留的共享面是 `~/Library/Preferences/com.viber.osx.plist`，其内容只有 App Center 分析 ID 与状态栏可见性，不含账号数据。

| 项 | 值 |
|---|---|
| 分支 | `fusion/viber-windows` → 已合并 `fusion/develop` |
| 实测 commit | `8af21b7a349e7eeea771cd79366cffe0b072fd40`（16 实例容量 + plist 键），`ce252680f64a91cdfbea92f8c33f604805e09dec`（cfprefsd 变体） |
| 实测 run | [40978053013](https://github.com/ananan28/haituo-fusion/actions/runs/40978053013)（success，容量 16）、[40976614605](https://github.com/ananan28/haituo-fusion/actions/runs/40976614605)（success，隔离审计） |
| 证据产物 | artifact `viber-macos-isolation`（id `12943513155`，`viber-macos-isolation.json` 272,481 字节）；截图 artifact `viber-macos-screenshot`（id `12943257317`） |
| 结论 | **feasible（单用户会话内，进程级 + profile 级；实测 16 并发）** |

## 1. 结论与证据链

上一版（v2–v4）判定为 infeasible，原因是只重定向了 `HOME`——守卫对象不在 HOME 里。v5 定位到守卫对象后，用三组只改一个变量的对照实验把因果钉死：

| 实验 | A 的 `TMPDIR` | B 的 `TMPDIR` | B 的 `HOME` | 第二个实例结果 |
|---|---|---|---|---|
| 对照（v4 机制） | 真实 | **真实（共享）** | 独立 | 存活但 **0 窗口**、独立 HOME **0 文件** |
| 只换 TMPDIR | 真实 | **独立** | 真实（共享） | **8 窗口**，10.7 秒 |
| TMPDIR + HOME | 真实 | **独立** | 独立 | **8 窗口**，5.1 秒，独立 profile 有写入 |
| 两边全隔离 | **独立** | **独立** | 两边各自独立 | A 8 窗口 / B 8 窗口，两边各 70 个 profile 文件 |

第一行与第二行只差 `TMPDIR` 一个变量，结果从"0 窗口"变成"8 窗口"；第三行加回独立 HOME 后 profile 才真正分开。因此：**`TMPDIR` 是那道锁的开关，`HOME` 是数据隔离的开关，两者都必须给。**

## 2. 守卫对象（实测定位）

在一个单独运行、fake HOME 的实例上按 PID 采集（`lsof -a -p <pid> -U`）后，Viber 唯一自有的命名对象是：

- `/private/var/folders/<user-hash>/T/Viber-0-1f5` —— Unix domain socket，`QLocalServer` 的监听端点
- `/private/var/folders/<user-hash>/T/qtsingleapp-Viber-0-1f5-lockfile` —— `QLockFile`，`QtSingleApplication` 的标准命名

支撑证据：

- 二进制中存在 `QLocalServer` 符号（`grep -a -c` 命中 3 处）。
- `/private/tmp` 下**没有**任何 Viber 对象（候选名 `Viber-0-2`、`Viber`、`Viber.lock` 等全部不存在），说明它不是机器级的固定路径。
- 多实例实验里每个实例都在**自己的** `TMPDIR` 下建同名 socket：`.../tmp_full_a/Viber-0-1f5` 与 `.../tmp_full_b/Viber-0-1f5` 同时存在、互不冲突。
- 把 `TMPDIR` 指向新目录的实例，启动 3 秒内就已持有自己的 socket（`sockets_b_initial` 非空）。

这解释了 macOS 与 Windows 的分歧：Windows 的守卫是命名管道 `\\.\pipe\Viber-0-2`，位于**机器级**命名空间，换 Windows 用户也无效；macOS 的守卫在**每个用户各自的** `/var/folders/<hash>/T/` 里，按进程注入环境变量即可分开。

## 3. 验证环境与方法

- Runner：`macos-latest`（macOS **26.6.2**、arm64、pwsh 7.6.6、单 GUI 会话用户 `runner`，`WindowServer` 运行中，Rosetta 可用）
- 工作流：[.github/workflows/viber-macos-isolation.yml](file:///C:/Users/AQ28n/Documents/Qoder/2026-10-29/aa3f5bdc/.github/workflows/viber-macos-isolation.yml)（`workflow_dispatch` + push 到 `fusion/viber-windows` 且脚本/工作流变更时触发，`timeout-minutes: 45`）
- 探针：[scripts/viber-macos-isolation.ps1](file:///C:/Users/AQ28n/Documents/Qoder/2026-10-29/aa3f5bdc/scripts/viber-macos-isolation.ps1)（schema `haituo-fusion/viber-macos-isolation/v3`）
- 安装包：`https://download.cdn.viber.com/desktop/mac_10_14/Viber.dmg`，`HTTP 200`，**188,184,253 字节**；`hdiutil` 挂载退出码 0。
- 应用：Viber **20.7.0 (2071)**、`com.viber.osx`、最低系统 macOS 10.14、**thin x86_64**（arm64 主机经 Rosetta 运行）、暂存体积 442,862,422 字节。
- 签名：`codesign` → `Developer ID Application: Viber Media SARL. (86ZW9CB9ZQ)`；`spctl` 结果 `accepted`、`source=Notarized Developer ID`。两份副本复制后 `xattr -dr com.apple.quarantine` 退出码 `[0,0]`。
- 窗口工具：Swift 助手调用 `CGWindowListCopyWindowInfo(optionAll)` 按 owner PID 计数；工具自检 `screens=1`、全系统 `total_windows_system=21`，排除"工具全盲"。
- 判定可行的条件（`second_instance_usable`）：A 有窗口、B 在自己的等待窗口内有窗口、B 向独立配置目录写入、A 在观测期结束时仍存活。

### 3.1 双开测试协议

每组先 `killall -9 Viber` 清场；A 直启后**等到真正出现窗口**（≤150 秒）才开始 B；B 启动后每 5 秒采样，观测 150 秒；每轮记录每个 PID 的窗口数、Unix socket / TCP 端点、独立 HOME 与 `TMPDIR` 的 socket 与文件、真实 `~/Library` 各 Viber 目录的文件数与最后写入时间。

## 4. 实测数据（run 40941016624）

| 测试 | 机制 | A | B 窗口 | B 独立 profile | 真实 profile 写入 | 判定 |
|---|---|---|---|---|---|---|
| single-baseline-open-a | `open -a`，真实 HOME | 150 秒内未出窗口（冷启动） | — | — | — | 基线未完成 |
| single-direct-exec-real-home | 直启，真实 HOME | 27.3 秒，4 窗口 | — | — | 否 | 单实例可用 |
| single-direct-exec-fake-home | 直启，重定向 HOME | 10.9 秒，3 窗口 | — | 有写入 | 否 | 配置隔离有效 |
| dual-direct-exec-fake-home（对照） | B 只换 HOME | 5.0 秒 | **0**（pid 5839，存活至结束） | 否（0 文件） | 是（A） | not_usable |
| dual-open-a-copied-bundle | 两个副本均 `open -a` | 5.2 秒 | **0**（新 pid 8315） | 否（沿用真实 HOME） | 是 | not_usable |
| open-n-same-bundle | A `open -a` 后再 `open -n` | 5.1 秒 | 2 秒后确实出现第 2 个 pid（10921、10939），随后回到 1 个 | 否 | — | not_usable |
| dual-tmpdir-only | B 只换 TMPDIR | 5.0 秒，8 窗口 | **8**（10.7 秒） | 否（共用真实 HOME） | 是 | 仅 primary |
| dual-tmpdir-plus-home | B 换 TMPDIR + HOME | 5.1 秒，8 窗口 | **8**（5.1 秒） | **是** | 是（prefs plist） | **usable** |
| dual-full-isolation | 两边各自 TMPDIR + HOME | 5.0 秒，8 窗口 | **8**（5.1 秒） | **是**（两边各 70 文件） | 是（仅 prefs plist） | **usable** |

`verdict`：`conclusion=feasible`、`usable_second_instances=2`、`primary_second_instances=3`、`guard_inventory_collected=true`、`errors=[]`。

### 4.1 容量扫描：一次开 16 个（run 40978053013）

同机按 1→16 逐个加实例，每个实例独立 `HOME` + `CFFIXED_USER_HOME` + `TMPDIR`，每次加完等窗口出现再采一次：

| n | 窗口 | 窗口出现 | 进程数 | 全部实例总 RSS |
|---|---|---|---|---|
| 1 | 是 | 5.0 s | 1 | 234.5 MB |
| 2 | 是 | 5.1 s | 2 | 466.5 MB |
| 4 | 是 | 5.1 s | 4 | 931.2 MB |
| 8 | 是 | 5.1 s | 8 | 1,860.1 MB |
| 12 | 是 | 5.1 s | 12 | 2,788.8 MB |
| 14 | 是 | 5.1 s | 14 | 3,254.0 MB |
| 16 | 是 | 5.1 s | **16** | **3,456.9 MB** |

- `capacity_max_instances_with_window = 16`、`capacity_rss_per_instance_mb = 216.1`、`errors = []`。
- **16 是我设的扫描上限，不是机器上限**：runner 共 7.5 GB 内存、3 vCPU，16 个实例占 3.46 GB，没有触发我设的 5 GB 中断阈值。
- 前 14 个近似线性（每个约 232 MB）；第 15、16 个的增量降到约 123 MB 和 80 MB，说明 7.5 GB 上开始有内存压力/共享页，实际可开数量要在目标机器上复测。
- 换算：16 GB 的 Mac 按 216 MB/实例算，纯内存可撑 60 个以上，**真正的瓶颈是窗口管理（每个实例 8 个窗口）、屏幕空间和账号风控，不是内存**。

## 5. 隔离边界（v6/v7 实测）

**成立的部分（有逐项对照）**

- **守卫对象分家**：全隔离那组里，A 持有 `tmp_full_a/Viber-0-1f5`、B 持有 `tmp_full_b/Viber-0-1f5`，两个 Unix socket 同时存在、互不干扰（run 40976614605）。
- **profile 分家**：A、B 各自的 `Library/Application Support/ViberPC` 各有 70 个文件（整个独立 HOME 各 70 个文件），`config.db` 的 inode 分别是 `3006791` 与 `3006913`（不同文件），内容摘要也不同（`d88914522d44…` vs `3899d74cdda0…`；`config.db` 本身是相同的空库骨架，差异在 `-wal`/`-shm`）。
- **只换 TMPDIR 不够**：`dual-tmpdir-only` 组 B 确实出窗口（8 个），但真实 `~/Library` 有 5 条路径被写（`ViberPC`、`Application Support/com.viber.osx`、`Caches`、`HTTPStorages`、`Preferences` plist）——两个实例会争同一份数据库，不能用于双账号。

**残留的共享面（尚未消除）**

- **`~/Library/Preferences/com.viber.osx.plist` 仍被共享写入**：全隔离组在观测期内只有这一条真实域路径发生变化（`last_write` 23:54:07 / 00:04 落在测试窗口内）。
- **`CFPREFERENCES_AVOID_DAEMON=1` 无效**：v7 加了该变体的对照（`dual-full-isolation-noprefs-daemon`），plist 依旧被写，两个实例的窗口仍正常出现——说明 Viber 走的是 `cfprefsd`，绕不过去。
- **那条 plist 里没有账号数据**：v8 导出该文件全部键，共 8 个——`MSAppCenter310*MigratedKey`（3 个迁移标记）、`MSAppCenterInstallId`、`MSAppCenterPastDevices`、`MSAppCenterSessionIdHistory`、`MSAppCenterUserIdHistory`、`NSStatusItem VisibleCC Item-0`（共 2,570 字节）。都是分析 SDK 的设备/会话 ID 和状态栏图标可见性；两个实例共用它最多互相覆盖图标显隐与分析 ID。
- **Keychain / 组容器：本轮未触达，不能算已验证**：`lsof` 在实例启动后按 PID 过滤 keychain、Group Containers、`Containers/com.viber`、`Saved Application State`，两个实例都是 0 条；但这是**从未登录过**的实例，登录后是否写 Keychain 没有测。

**操作约束**

- 必须直启 `Viber.app/Contents/MacOS/Viber`：`open -a` 走 LaunchServices 带不了环境变量，第二个副本会被合并/吞掉；`open -n` 只会短暂出现新 pid。
- 每个实例必须同时给 `TMPDIR` + `HOME` + `CFFIXED_USER_HOME`，缺一个就退化成"能开但数据混在一起"。

## 6. 截图证据

### 6.1 四个实例同时跑（run 40979653614）

| 实例 | pid | 窗口 id | 窗口尺寸 | 窗口出现 | 窗口图 sha256 前 16 位 |
|---|---|---|---|---|---|
| 1 | 2102 | 33 | 1050×650 | 201.7 s | `a489986bede8ffa4` |
| 2 | 2196 | 34 | 1050×650 | 201.7 s | `9594081a501506e7` |
| 3 | 2217 | 31 | 1050×650 | 201.7 s | `1989542e00f49f5a` |
| 4 | 2228 | 32 | 1050×650 | 201.7 s | `e5fca03761c713a6` |

- 五个 `screencapture` 调用（整屏 + 4 个窗口）退出码全为 0；四张窗口图摘要互不相同，QR 码内容也互不相同 → 四个独立会话。
- 结束时四个进程全部存活；整屏里 Dock 右侧并排四个 Viber 图标。
- 201.7 秒是本次 job 首次冷启动（新装 + Rosetta 首次翻译 + 四个全新 profile），热态直启约 5 秒。

### 6.2 两个实例（run 40977446384）

- 工作流 [.github/workflows/viber-macos-screenshot.yml](file:///C:/Users/AQ28n/Documents/Qoder/2026-10-29/aa3f5bdc/.github/workflows/viber-macos-screenshot.yml)，探针 [scripts/viber-macos-screenshot.ps1](file:///C:/Users/AQ28n/Documents/Qoder/2026-10-29/aa3f5bdc/scripts/viber-macos-screenshot.ps1)。
- 产物：整屏 `viber-two-instances-full.png` + 逐窗口 `viber-window-A.png`（窗口 id 37, pid 5162）/ `viber-window-B.png`（窗口 id 36, pid 5372），三张 `screencapture` 退出码均为 0（未被 TCC 拦截）。
- 两张窗口图的 QR 码内容不同 → 两个独立会话；Dock 右侧并排两个 Viber 图标。
- 冷启动耗时 388.9 秒（新装 + Rosetta 首次翻译 + 全新 profile），热态直启只要 5 秒左右，两者不要混用。


## 7. 结论边界：合成实测 vs 真实账号验证

- 本文数据来自 **CI 干净 runner 的进程级实测**：无任何 Viber 账号、无凭据、无登录。`feasible` 指的是"两个进程都完成 UI 初始化并各写独立 profile"，**不是**"两个真实账号同时在线、能收发消息/通话"。
- **已验证**：守卫对象的路径与类型、`TMPDIR` 与 `HOME` 的分工作用、双实例窗口与 profile 写入、LaunchServices 路径不可用。
- **未验证**：真实账号登录后的消息收发与通话、两台设备绑定同一手机号的行为、登录后是否写 Keychain、独立 macOS 用户、每实例独立出口 IP。（多实例并发内存已测：16 个实例 3.46 GB，见 4.1。）
- 单机多实例**不能**做到每实例独立出口 IP：macOS 没有按进程的网络命名空间；需要独立 IP 时只能每实例一台虚拟机/主机。

## 8. 与 Windows 结论对比

| 平台 | 守卫对象 | 位置 | 环境隔离能否突破 | 结论 |
|---|---|---|---|---|
| Windows（[windows-viber-isolation.md](file:///C:/Users/AQ28n/Documents/Qoder/2026-10-29/aa3f5bdc/docs/windows-viber-isolation.md)） | 命名管道 `\\.\pipe\Viber-0-2` | **机器级**命名空间 | 否（换 Windows 本地用户也失败） | infeasible |
| macOS（本文） | Unix socket `$TMPDIR/Viber-0-1f5` + `qtsingleapp-...-lockfile` | **每用户**临时目录 | **是**（每进程 `TMPDIR` 即可） | **feasible** |

## 9. 复现方式

```bash
# 触发：push 到 fusion/viber-windows 且改动 scripts/viber-macos-isolation.ps1 或工作流文件
# 或手动：Actions -> "Viber macOS isolation probe" -> Run workflow
```

产物：`viber-macos-isolation` → `audit-results/viber-macos-isolation.json`（含 `guard_object`、`launch_tests[*].sockets_a/sockets_b`、逐次采样与 `verdict`）。

## 10. 运行记录

| run | commit | 结论 | 说明 |
|---|---|---|---|
| 40914501832 | 844963a5 | failure | `$home` 只读变量冲突，双开测试未启动；验证了下载/挂载/签名/窗口工具 |
| 40915316627 | 456fd215 | success | 修正启动参数与基线；基线 30 秒超时导致 `inconclusive` |
| 40916882039 | 849e381c | success | 直启单实例 65.7 秒出窗口；`$Pid` 参数冲突导致后两组被跳过 |
| 40918634471 | f09050fb | success | 单实例重定向 HOME 可跑、第二实例三入口全部无法初始化 |
| 40920386575 | 5ba2a574 | success | v4：完整观测 LaunchServices 副本（0 窗口后退出）与 `open -n`；当时未测 `TMPDIR`，结论为 infeasible |
| 40941016624 | 98cb1d4a | success | v5：定位守卫为 `$TMPDIR` 下的 QtSingleApplication socket/lockfile；`TMPDIR`+`HOME` 隔离双开成立，结论修正为 **feasible** |
| 40975465332 | 5b80bc0e | success | v6：加容量扫描与隔离审计骨架；容量段因 `$home` 只读变量冲突未跑 |
| 40976362641 | 8ffb1b0b | success | 截图首版：整屏图可用，但逐窗口抓取参数被 `$args` 吞掉，三张图都是整屏 |
| 40976614605 | ce252680 | success | v7：容量 8 实例全出窗口（235 MB/实例）；`CFPREFERENCES_AVOID_DAEMON=1` 无法阻止 plist 写入 |
| 40977446384 | 9f435288 | success | 截图修正版：`-l <窗口id>` 逐窗口抓到 A/B 两张（QR 码不同），冷启动 388.9 s |
| 40978053013 | 8af21b7a | success | v8：16 实例全部出窗口（216 MB/实例）；plist 键清单导出，无账号字段 |
| 40979653614 | a44cb8cd | success | 四实例截图：4/4 出窗口、4 张窗口图互不相同（QR 各异），冷启动 201.7 s |

## 11. 真实账号登录与设备身份（2026-10-31 追加）

**结论：多窗口/多进程成立，但"多账号登录"在同一台 Mac 上不可行——Viber 的设备身份绑定了硬件 UDID。**

实测链路（用户真机 + CI 反向）：

1. 挂 VPN（全局/TUN）后，**第一个账号能登录，第二个起全部失败**，且诊断包无崩溃报告 → 不是崩溃，是服务端把第二个实例当成"同一台设备"拒了。
2. 二进制逆向（run 41156778266）：Viber 20.7.0 是 Qt6 非沙盒应用，钥匙串只被 AppCenter 分析 SDK 用来存 InstallId（会话不在钥匙串）；config.db 的 `Accounts` 表有 `DeviceKey` 字段；共享容器 `~/Library/Containers/com.viber.osx.macvibershare/` 只是空壳，无身份文件。
3. 决定性证据（probe3，run 41157641637）：二进制内有字符串 **`Error while generating hash from UDID and deviceKey`** 与 **`IOPlatformUUID`** —— 即设备身份 = `hash(UDID + deviceKey)`，其中 UDID 来自硬件 `IOPlatformUUID`。同一台 Mac 的所有实例读到的 IOPlatformUUID 完全相同，无法 per-process 伪造。

**因此：**
- 多开（多个窗口/进程、profile 分离）——可行，已交付 GUI 启动器。
- 多账号（每个窗口登不同账号）——裸机 macOS 不可行，因为设备身份=硬件 UDID。
- 规模化路线（与 [[project-viber-multiaccount-strategy]] 一致并坐实）：**每账号一台 VM**（VM 有独立虚拟硬件 UUID）或 **Android 模拟器/容器**（每个容器是独立"设备"）。这不仅是 IP 隔离问题，设备身份同样需要 VM/容器。

**How to apply：** 若继续，方向从"改 Viber 环境变量隔离"转向"VM/容器规模化"；GUI 启动器可作为容器外的统一管理入口，但不再以"单机多账号"为目标。

## 12. hook 伪造硬件 UUID（2026-10-31 晚追加，机制已实证）

第 11 节结论"裸机不可行"已过时——**hook 路线机制上已走通**，最终待真机账号验证。

- 原理：注入 `scripts/spoof_uuid.c`（dyld interpose，hook `IORegistryEntryCreateCFProperty`/`IORegistryEntrySearchCFProperty`），按环境变量 `FAKE_IO_PLATFORM_UUID` 给每个进程返回不同的 `IOPlatformUUID`。
- 三个关键坑（run 41159140138，commit `0bfe4031`）：① Viber 开 hardened runtime（`flags=0x10000(runtime)`）→ 直接注入被拒，需 `codesign --force --deep --sign - --entitlements <entitlements>` 重签去 runtime；② 注入库必须 x86_64（Viber 是 x86_64，Apple Silicon 上走 Rosetta），编译成 universal；③ 不能 interpose `sysctlbyname`（dlsym 递归崩溃），只 hook IOKit。
- 实证：helper 测试 IOPlatformUUID 被替换为假值；`vmmap` 证实 dylib 映射进 Viber 进程、Viber 带注入正常存活。
- **未验证**：Viber 服务端是否真按新 UUID 放行第二个账号登录（只有真机真账号能证）。
- 已集成进启动器（commit `6d1575a6`）：每账号 `deviceUUID`、启动注入 dylib + 假 UUID、「准备 Viber（重签名）」按钮。
