# macOS 上隔离多个 Viber 实例 — 实测结论

**结论（一句话）**：macOS 单个用户会话内**可以双开**——Viber 的单实例守卫是 QtSingleApplication 在用户临时目录 `$TMPDIR` 下的一个 Unix socket（`Viber-0-1f5`）加一个锁文件（`qtsingleapp-Viber-0-1f5-lockfile`）；给每个实例注入独立的 `TMPDIR` + `HOME` + `CFFIXED_USER_HOME` 后直启，两个实例各自完成初始化（各 8 个窗口）、各写各的 profile。唯一残留的共享面是 `~/Library/Preferences/com.viber.osx.plist`。

| 项 | 值 |
|---|---|
| 分支 | `fusion/viber-windows` → 已合并 `fusion/develop` |
| 实测 commit | `98cb1d4a74f41badb23f7f7e4ced1f7f326556c5` |
| 实测 run | [40941016624](https://github.com/ananan28/haituo-fusion/actions/runs/40941016624)（success） |
| 证据产物 | artifact `viber-macos-isolation`（id `12927413029`，zip 13,644 B）；`audit-results/viber-macos-isolation.json` 187,458 字节 |
| 结论 | **feasible（单用户会话内，进程级 + profile 级）** |

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

## 5. 隔离边界

- **profile 数据隔离成立**：独立 HOME 下 `Library/Application Support/ViberPC`、`com.viber.osx`、`Caches`、`HTTPStorages` 均落到各自目录，两个实例各写 70 个文件、互不重叠。
- **偏好设置仍共享**：`CFFIXED_USER_HOME` 没能阻止 `cfprefsd`，真实 `~/Library/Preferences/com.viber.osx.plist` 仍被更新（本轮两个隔离实验都观测到）。两个实例会踩同一份 UI 偏好，可能出现设置互相覆盖；这与账号数据无关，但属于残留污染。
- **启动方式有约束**：`open -a` 走 LaunchServices，无法携带环境变量，且第二个副本会被合并/吞掉；`open -n` 本轮观测到新 pid 短暂出现后消失。要双开必须直启 `Viber.app/Contents/MacOS/Viber`。
- **不要只换 TMPDIR**：那样虽然能多开，但两个实例共用同一个 `ViberPC` 目录，数据库争用有损坏风险。

## 6. 结论边界：合成实测 vs 真实账号验证

- 本文数据来自 **CI 干净 runner 的进程级实测**：无任何 Viber 账号、无凭据、无登录。`feasible` 指的是"两个进程都完成 UI 初始化并各写独立 profile"，**不是**"两个真实账号同时在线、能收发消息/通话"。
- **已验证**：守卫对象的路径与类型、`TMPDIR` 与 `HOME` 的分工作用、双实例窗口与 profile 写入、LaunchServices 路径不可用。
- **未验证**：真实账号登录后的消息收发与通话、两台设备绑定同一手机号的行为、多实例并发的 CPU/内存占用、独立 macOS 用户、每实例独立出口 IP。
- 单机多实例**不能**做到每实例独立出口 IP：macOS 没有按进程的网络命名空间；需要独立 IP 时只能每实例一台虚拟机/主机。

## 7. 与 Windows 结论对比

| 平台 | 守卫对象 | 位置 | 环境隔离能否突破 | 结论 |
|---|---|---|---|---|
| Windows（[windows-viber-isolation.md](file:///C:/Users/AQ28n/Documents/Qoder/2026-10-29/aa3f5bdc/docs/windows-viber-isolation.md)） | 命名管道 `\\.\pipe\Viber-0-2` | **机器级**命名空间 | 否（换 Windows 本地用户也失败） | infeasible |
| macOS（本文） | Unix socket `$TMPDIR/Viber-0-1f5` + `qtsingleapp-...-lockfile` | **每用户**临时目录 | **是**（每进程 `TMPDIR` 即可） | **feasible** |

## 8. 复现方式

```bash
# 触发：push 到 fusion/viber-windows 且改动 scripts/viber-macos-isolation.ps1 或工作流文件
# 或手动：Actions -> "Viber macOS isolation probe" -> Run workflow
```

产物：`viber-macos-isolation` → `audit-results/viber-macos-isolation.json`（含 `guard_object`、`launch_tests[*].sockets_a/sockets_b`、逐次采样与 `verdict`）。

## 9. 运行记录

| run | commit | 结论 | 说明 |
|---|---|---|---|
| 40914501832 | 844963a5 | failure | `$home` 只读变量冲突，双开测试未启动；验证了下载/挂载/签名/窗口工具 |
| 40915316627 | 456fd215 | success | 修正启动参数与基线；基线 30 秒超时导致 `inconclusive` |
| 40916882039 | 849e381c | success | 直启单实例 65.7 秒出窗口；`$Pid` 参数冲突导致后两组被跳过 |
| 40918634471 | f09050fb | success | 单实例重定向 HOME 可跑、第二实例三入口全部无法初始化 |
| 40920386575 | 5ba2a574 | success | v4：完整观测 LaunchServices 副本（0 窗口后退出）与 `open -n`；当时未测 `TMPDIR`，结论为 infeasible |
| 40941016624 | 98cb1d4a | success | v5：定位守卫为 `$TMPDIR` 下的 QtSingleApplication socket/lockfile；`TMPDIR`+`HOME` 隔离双开成立，结论修正为 **feasible** |
