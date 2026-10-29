# macOS 上隔离第二个 Viber 实例 — 实测结论

**结论（一句话）**：在 macos-latest 上，单个 macOS 用户会话内无法隔离出第二个可用 Viber 实例——单实例在重定向 HOME 下可正常初始化并写入独立配置目录，但第二个实例无论直启还是经 LaunchServices 拉起，都不产生窗口（直启版存活空转，LaunchServices 版随后退出）。

| 项 | 值 |
|---|---|
| 分支 | `fusion/viber-windows` → 已合并 `fusion/develop` |
| 实测 commit | `5ba2a5743fb6051d6f9867289e7966617b8a6a8c` |
| 实测 run | [40920386575](https://github.com/ananan28/haituo-fusion/actions/runs/40920386575)（success） |
| 证据产物 | artifact `viber-macos-isolation`（id `12918583494`，`audit-results/viber-macos-isolation.json`，9,945 字节） |
| 结论 | **infeasible（不可行，单用户会话内）** |

## 1. 结论与依据

| 测试 | 第一个实例 | 第二个实例 | 结果 |
|---|---|---|---|
| 直启 B + 重定向 HOME（A 真实 HOME） | 5.0 秒出窗口 | pid 3608 存活 90 秒，**0 窗口**，独立 HOME **0 文件** | not_usable |
| `open -a` 拉起第二副本（LaunchServices） | 5.4 秒出窗口 | 新进程 6003，**90 秒内 0 窗口**，观测结束时已退出（进程数回到 1） | not_usable |
| `open -n` 请求新实例 | 5.0 秒出窗口 | 命令返回 0，**没有新增进程**（2 秒后与结束时均只有 1 个） | not_usable |

三项互相独立的入口全部无法得到第二个"有窗口、有独立配置写入"的实例；而同样的直启方式 + 重定向 HOME 在**只跑一个实例**时可完整初始化（5.0 秒、8 个窗口、独立 HOME 有写入），LaunchServices 单实例也正常（115.7 秒冷启动、8 个窗口），证明方法与配置隔离本身有效，失败可归因于 Viber 的单实例守卫。

## 2. 验证环境与方法

- Runner：`macos-latest`（macOS **26.6.2**、arm64、pwsh 7.6.x、单 GUI 会话用户 `runner`，`WindowServer` 运行中，Rosetta 可用）
- 工作流：[.github/workflows/viber-macos-isolation.yml](file:///C:/Users/AQ28n/Documents/Qoder/2026-10-29/aa3f5bdc/.github/workflows/viber-macos-isolation.yml)（`workflow_dispatch` + push 到 `fusion/viber-windows` 且脚本/工作流变更时触发，`timeout-minutes: 45`）
- 探针：[scripts/viber-macos-isolation.ps1](file:///C:/Users/AQ28n/Documents/Qoder/2026-10-29/aa3f5bdc/scripts/viber-macos-isolation.ps1)
- 安装包：`https://download.cdn.viber.com/desktop/mac_10_14/Viber.dmg`，`HTTP 200`，**188,184,253 字节**（DNS 解析 3.167.246.71/15/83/99）；`hdiutil` 挂载退出码 0。
- 应用：Viber **20.7.0 (2071)**、`com.viber.osx`、最低系统 macOS 10.14、**thin x86_64**（arm64 主机经 Rosetta 运行）、暂存体积 442,862,422 字节。
- 签名：`codesign` Authority `Developer ID Application: Viber Media SARL. (86ZW9CB9ZQ)` → `Developer ID Certification Authority` → `Apple Root CA`；`spctl` 结果 `accepted`、`source=Notarized Developer ID`。
- 副本去隔离：两份 `.app` 复制后 `xattr -dr com.apple.quarantine` 退出码 `[0,0]`，复查无隔离属性残留。
- 窗口工具：编译 Swift 助手调用 `CGWindowListCopyWindowInfo(optionAll)`，按 owner PID 计数；工具自检 `screens=1`、全系统 `total_windows_system=21`，排除"工具全盲"。
- 判定可行（`second_instance_usable`）必须同时满足：第一个实例有窗口、第二个实例在等待窗口内有自己的窗口、第二个实例向独立配置目录写入、A 在观察期结束时仍存活。

### 2.1 启动方式校准（实测的两个坑）

1. **首次冷启动很慢**：安装后第一次用 `open -a` 启动，上一轮 150 秒内 0 窗口（基线超时），本轮 115.7 秒出窗口；此后再启动稳定在 5.0–5.4 秒。据此把"等待窗口"作为每组测试的前置条件，避免把"应用还没初始化完"误判为"第二实例被拦截"。
2. **`$Pid` 是 PowerShell 只读自动变量**：早前 run 中函数参数 `[int]$Pid` 抛 "Cannot overwrite variable Pid"，导致后续两组测试被跳过；已改为 `$TargetPid`，并让每个测试独立 try/catch，单组异常不再中止其余测试。

### 2.2 双开测试协议

每组测试先 `killall -9 Viber` 清场；A 启动后**等待真正出现窗口**（≤150 秒）才开始 B；B 启动后按 5 秒采样，直启组观测 90 秒，LaunchServices 组先等新进程出现（≤30 秒）再对新 PID 观测 90 秒；记录每个 PID 的窗口数、进程数、独立 HOME 与真实 `~/Library` 各 Viber 目录的文件数/最后写入时间。

## 3. 实测数据（run 40920386575）

| 测试 | 启动方式 | A 初始化 | B 进程 | B 窗口 | B 独立配置写入 | 真实 profile 写入 | 判定 |
|---|---|---|---|---|---|---|---|
| single-baseline-open-a | `open -a`，真实 HOME | **115.7 秒**，8 窗口（冷启动） | — | — | — | 否 | 单实例可用 |
| single-direct-exec-real-home | 直启，真实 HOME | **5.0 秒**，8 窗口 | — | — | — | 否 | 单实例可用 |
| single-direct-exec-fake-home | 直启，重定向 HOME | **5.0 秒**，8 窗口 | — | — | **是** | 否（v3 曾见 Preferences plist 更新） | 配置隔离有效 |
| dual-direct-exec-fake-home | A 直启真实 HOME，B 直启重定向 HOME | **5.0 秒** | pid 3608 存活 90 秒 | **0** | **否（0 文件）** | 是（A 写入） | not_usable |
| dual-open-a-copied-bundle | A、B 均 `open -a` 两个副本 | **5.4 秒** | 新 pid 6003，90 秒内退出 | **0** | 否（沿用真实 HOME） | 是 | not_usable |
| open-n-same-bundle | A `open -a`，再 `open -n` | **5.0 秒** | **无新进程** | — | — | — | not_usable |

补充证据：

- `Info.plist` 中**没有** `LSMultipleInstancesProhibited`、`LSEnvironment`、`LSUIElement` 等键（`plutil -p` 仅命中 `CFBundleIdentifier`）。
- 应用二进制中**未发现** `--user-data-dir` / `--profile` / `--data-dir` 一类配置目录参数（`grep -a` 结果为空）。
- 重定向 HOME 时，`~/Library/Application Support/com.viber.osx`、`ViberPC`、`HTTPStorages`、`Caches` 均落到独立 HOME；真实 `~/Library/Preferences/com.viber.osx.plist` 的写入不稳定（v3 观测到更新、v4 未观测到），因此不能视为完全隔离。
- 锁采集（`lsof -c Viber`）看到的是应用文件、Rosetta 运行时与工作目录，**未定位**到 Viber 自有的命名锁对象；单实例守卫的具体载体（mach service / 本地 socket / 共享内存）本次未确认。
- 每 5 秒一条采样（PID、窗口数、目录统计）均在证据 JSON 的 `launch_tests[*].samples` 中，可直接复核。

## 4. 机制解读

- macOS 侧的单实例限制发生在**应用初始化极早期**：`open -a` 第二副本能拉出新 PID，但 90 秒内不产生任何窗口并在观测期内退出；直启的第二进程则保持存活但同样不建窗口、不写配置，属于"空转"。
- `open -n` 在 Viber 上不产生新进程（命令返回 0），与"LaunchServices 已把请求合并到现有实例"一致；仅靠 `open -n` 无法双开。
- HOME 重定向对 Qt 的 `QStandardPaths`（Application Support/Caches）有效，但偏好设置可能仍写回真实用户域（`CFPreferences` 由 `cfprefsd` 处理，v3 观测到真实 plist 更新）；即使守卫问题被绕过，配置隔离也不完整。
- 因此，在**一个 macOS 用户会话**内没有可用的双开路径：既没有应用级 profile 参数，环境重定向也无法让第二个进程完成初始化。

## 5. 结论边界：合成实测 vs 真实账号验证

- 本文数据来自 **CI 干净 runner 的进程级实测**（无任何真实 Viber 账号、无凭据、无登录），属于"合成环境下的真实进程行为测量"，**不是**真实账号双开验证。
- **已验证**：进程存活、每 PID 窗口、profile 目录写入、签名/公证、启动方式差异。
- **未验证**：独立 macOS 用户（CI 只有一个 GUI 登录会话，`launchctl asuser` 无第二会话可用）；经 `LSEnvironment` 在 LaunchServices 启动时注入 HOME；真实账号的消息收发/通话。
- 结论仅覆盖"同一 macOS 用户会话内同时运行两个 Viber 实例"。若业务必须双账号在线，可考虑独立 macOS 用户（需真实桌面会话）或整机/虚拟机级隔离；二者均未在本任务中验证。

## 6. 与 Windows 结论对比

| 平台 | 第二实例表现 | 配置隔离 | 结论 |
|---|---|---|---|
| Windows（[windows-viber-isolation.md](file:///C:/Users/AQ28n/Documents/Qoder/2026-10-29/aa3f5bdc/docs/windows-viber-isolation.md)） | 立即 exit code 0，0 窗口 | 环境变量重定向无效（Qt known-folder） | infeasible |
| macOS（本文） | 直启存活但 0 窗口 0 写入；LaunchServices 副本无窗口后退出；`open -n` 不新起进程 | HOME 重定向对配置目录有效、对偏好设置无效 | infeasible（单用户会话） |

两平台都表现为**用户级单实例守卫**：Viber 不提供多账号并行入口，第二实例即使被强行拉起也无法进入可用状态。

## 7. 复现方式

```bash
# 触发：push 到 fusion/viber-windows 且改动 scripts/viber-macos-isolation.ps1 或工作流文件
# 或手动：Actions -> "Viber macOS isolation probe" -> Run workflow
```

产物：`viber-macos-isolation` → `audit-results/viber-macos-isolation.json`（结构化证据，含逐次采样、窗口自检、签名/架构、每项测试结果与 verdict）。

## 8. 运行记录

| run | commit | 结论 | 说明 |
|---|---|---|---|
| 40914501832 | 844963a5 | failure | `$home` 只读变量冲突，双开测试未启动；验证了下载/挂载/签名/窗口工具 |
| 40915316627 | 456fd215 | success | 修正启动参数与基线；基线 30 秒超时导致 `inconclusive`，但发现 `open -n` 只起 1 个进程 |
| 40916882039 | 849e381c | success | 直启单实例 65.7 秒出窗口；`$Pid` 参数冲突导致后两组被跳过 |
| 40918634471 | f09050fb | success | 单实例重定向 HOME 可跑、第二实例三入口全部无法初始化；LaunchServices 组观测不完整 |
| 40920386575 | 5ba2a574 | success | 最终证据：完整观测 LaunchServices 副本（0 窗口后退出）与 `open -n`（无新进程） |
