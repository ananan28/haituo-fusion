# Windows 上隔离第二个 Viber 实例 — 实测结论

**结论（一句话）**：在 windows-latest 上无法隔离出第二个可独立运行的 Viber 实例——三种方案下第二个进程都立即以 exit code 0 退出、0 窗口，配置目录也无法通过环境变量重定向。

| 项 | 值 |
|---|---|
| 分支 | `fusion/viber-windows` → 已合并 `fusion/develop` |
| 实测 commit | `2c64fec7a6002e4eb875047dcceacd83237532bd` |
| 实测 run | [40899674589](https://github.com/ananan28/haituo-fusion/actions/runs/40899674589)（success） |
| 证据产物 | artifact `viber-windows-isolation`（id `12909146407`，`audit-results/viber-windows-isolation.json`，20,989 字节） |
| 结论 | **infeasible（不可行）** |

## 1. 结论与依据

三种互相独立的双开方案全部失败，失败方式一致：

1. **独立配置目录（fresh profile + 环境变量重定向）**——A 存活、9 个窗口；B 启动后立即退出（exit code 0）、0 个窗口。
2. **独立配置目录（复制 `%APPDATA%\ViberPC` 后重定向）**——同上，B 立即退出。
3. **独立 Windows 本地用户**（`CreateProcessWithLogonW`，一次性本地账户 `haituo_viber_b`，安装目录复制到 `C:\Users\Public\viber-probe-copy` 规避 ACL）——B 依然立即退出，说明单实例保护是**机器级**的，不随用户会话隔离。

另外，`APPDATA` / `LOCALAPPDATA` 环境变量重定向对 Viber **无效**：重定向目录始终 0 个文件（`redirection_effective=false`），Viber 始终写入真实的 `%APPDATA%\ViberPC`（Qt 的 known-folder API 不读取环境变量）。

## 2. 验证环境与方法

- Runner：`windows-latest`（Microsoft Windows Server 2025 Datacenter，PowerShell 7.6.7，管理员）
- 工作流：[.github/workflows/viber-isolation.yml](file:///C:/Users/AQ28n/Documents/Qoder/2026-10-29/aa3f5bdc/.github/workflows/viber-isolation.yml)（`workflow_dispatch` + push 到 `fusion/viber-windows` 且脚本/工作流变更时触发，`timeout-minutes: 30`）
- 探针：[scripts/viber-isolation.ps1](file:///C:/Users/AQ28n/Documents/Qoder/2026-10-29/aa3f5bdc/scripts/viber-isolation.ps1)
- 所有安装、启动、测量均在 GitHub Actions 的 runner 上完成；本地未安装依赖、未构建、未跑项目测试。

### 2.1 安装器获取（含失败证据）

| 候选 URL | DNS | HTTP | 结果 |
|---|---|---|---|
| `https://get.viber.com/download/ViberSetup.exe`（任务给定直链） | **NXDOMAIN**（`get.viber.com : DNS name does not exist.`，另经 dns.google DoH 复核 Status 3） | `0`（curl 未发出请求） | 失败：该域名在全球 DNS 已不存在 |
| `https://download.cdn.viber.com/desktop/windows/ViberSetup.exe`（官方 CDN 引导器） | `65.8.180.90` | `200`，2,752,760 字节 | 下载成功，Authenticode `Valid`（`CN=Viber Media S.a r.l.`，DigiCert Trusted G4） |
| `https://download.cdn.viber.com/desktop/windows/29.1.0/ViberSetup.msi`（官方 CDN 版本化 MSI） | 解析成功 | `200`，149,585,920 字节 | 签名 `Valid`；`msiexec /qn` 退出码 `0` |

引导器 `ViberSetup.exe` 以 `/S` 启动在 CI 上不稳定（`Start-Process` 报 "This command cannot be run completely because the system cannot find all the information required"，作为非致命证据记录），因此确定性回退到官方 29.1.0 MSI；安装结果为 `%LOCALAPPDATA%\Viber\Viber.exe`（签名 `Valid`，`Viber Media S.a r.l.`）。

### 2.2 锁检测方法

- **命名管道**：枚举 `\\.\pipe\` 中匹配 `viber` 的条目（安装/启动前基线为空 `[]`）。
- **命名 mutex**：`NtQuerySystemInformation(SystemExtendedHandleInformation, 64)` 取全系统句柄快照（头 **16 字节** = `NumberOfHandles` + `Reserved`，每条 40 字节），按 PID 过滤后用 `NtDuplicateObject` + `NtQueryObject(ObjectNameInformation)` 取名字；同时记录这些 PID 持有的**全部**命名 mutex（不止 `viber` 关键字），以便判断锁名是否与实例一一对应。
- **自检**：探针先创建已知名称的 marker mutex，再在快照中按"本进程 + 句柄值"反查其 `ObjectTypeIndex`，用该索引识别 Mutant 类型；`methodology_self_check` 必须为 true 本次枚举才算数。
- **缓冲区策略（本 run 的两个实测坑）**：零长度大小查询只返回假值 56 字节；必须从真实缓冲区起步，每次 `STATUS_INFO_LENGTH_MISMATCH (0xC0000004)` 用返回的所需长度 + 1 MB 余量重试（最多 8 次）。本 run 实测重试 **2 次**成功，快照 **50,930 条**、缓冲区 **3,085,792 字节**。

### 2.3 双开测试协议

每个测试：A 启动 → 10 秒后 B 启动 → 45 秒存活采样（每 5 秒一次，记录两个 PID 的存活、窗口数、各自配置目录文件数）→ 判定窗口内双存活是否 ≥ 30 秒。判定可行的条件：双存活 + 各自有窗口 + 各自配置目录有写入，缺一不可。

## 3. 实测数据（run 40899674589）

| 测试 | A 存活 | B 存活 | A 窗口 | B 窗口 | A 配置写入 | B 配置写入 | 结果 |
|---|---|---|---|---|---|---|---|
| fresh-profiles（环境变量重定向） | 是 | 否（exit 0） | 9 | 0 | 否 | 否 | not_observed |
| copied-viberpc（复制 ViberPC 后重定向） | 是 | 否（exit 0） | 9 | 0 | 否 | 否 | not_observed |
| separate-windows-user（独立本地用户） | 是 | 否（exit 0） | 9 | 0 | 否 | 否 | not_observed |

- 三种测试下 `redirection_effective` 均为 `false`，真实 `%APPDATA%\ViberPC` 持续被写入（`real_roaming_written=true`）。
- **第三实例探针**：A 存活时再启动第三个进程，15 秒内退出（exit code 0），与单实例保护一致。
- **命名管道**：`\\.\pipe\Viber-0-2` 存在；安装/启动前基线为空，说明该管道由 Viber 创建，且是单一机器级名称（不含 PID，非按实例命名）。
- **命名 mutex（Viber A 全部持有项）**：共 6 个，均为系统/图形栈对象——`\Sessions\2\BaseNamedObjects\SM0:6504:304:WilStaging_02`、`\Sessions\2\BaseNamedObjects\DBWinMutex`、`\Sessions\2\BaseNamedObjects\SM0:6504:120:WilError_03`、`\Sessions\2\BaseNamedObjects\mfx_d3d_mutex`、`\Sessions\2\BaseNamedObjects\__DDrawExclMode__`、`\Sessions\2\BaseNamedObjects\__DDrawCheckExclMode__`；**没有任何 Viber 命名的 mutex**（`viber_named_mutexes=[]`）。
- 锁分析自检：`methodology_self_check=true`，`mutant_type_index=22`，`errors=[]`。

## 4. 机制解读

- Viber 桌面端（Qt）使用**机器级单实例保护**：第二个进程在初始化早期主动退出（exit code 0，而非崩溃），跨 Windows 用户依然生效；Viber 唯一命名的内核对象是机器级管道 `\\.\pipe\Viber-0-2`（第二、第三个实例都无法与它共存）。
- 配置目录由 Qt known-folder（`SHGetKnownFolderPath`）决定，**不读取 `APPDATA`/`LOCALAPPDATA` 环境变量**，"独立配置目录"方案在进程环境层面无法成立。
- 单实例保护生效时 B 不创建窗口、不写配置目录、不参与消息循环——即使强行保留进程也无法登录第二个账号。

## 5. 结论边界：合成实测 vs 真实账号验证

- 本文数据来自 **CI 干净 runner 的进程级实测**（无任何真实 Viber 账号、无凭据登录）。这属于"合成环境下的真实进程行为测量"，**不是**真实账号双开验证。
- **未验证**：登录两个真实账号后的消息收发、通话、同步行为；未使用任何真实账号或凭据。
- 结论仅覆盖"同一 Windows 主机上同时运行两个 Viber 实例"；若业务必须双账号在线，可行路径是独立 Windows 沙箱/虚拟机/容器（每个实例一个 OS 边界），本任务未做该验证。

## 6. 复现方式

```bash
# 触发：push 到 fusion/viber-windows 且改动 scripts/viber-isolation.ps1 或工作流文件
# 或手动：Actions -> "Viber Windows isolation probe" -> Run workflow
```

产物：`viber-windows-isolation` → `audit-results/viber-windows-isolation.json`（结构化证据，含每条检查的实测值）。

## 7. 运行记录

| run | commit | 结论 | 说明 |
|---|---|---|---|
| 40827974919 | e521a254 | success | 首次完整采集；锁枚举失败的早期版本 |
| 40829304627 | 6116edfb | failure | 引导器 `Start-Process` 异常中止（已修复为非致命） |
| 40830059686 | e3290103 | success | 三种双开方案全部 `not_observed`；锁枚举 0xC0000004 |
| 40898192403 | 63077fe6 | success | 修正句柄快照布局与缓冲区策略后复现同一结论 |
| 40899674589 | 2c64fec7 | success | 最终证据：新增全量 mutex 名单与安装前管道基线 |
