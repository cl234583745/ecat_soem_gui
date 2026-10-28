# ECAT Bench

紧凑型 EtherCAT 主站调试台。目标是把网卡选择、从站扫描、状态机、SDO/PDO、邮箱诊断和 FoE 固件维护放进一个类似串口调试助手的桌面工具，而不是完整的 PLC 工程平台。

## 当前状态

| 模块 | 状态 |
| --- | --- |
| React/Electron 桌面操作台 | 可运行 |
| Electron 主进程与原生核心 | SOEM 优先，失败后回退原生模拟核心或 TypeScript 模拟核心 |
| SOEM v2 物理后端 | 已编译；NPF 网卡枚举已通过 |
| 真实从站扫描与 OP | 已使用 Renesas EtherCAT RA8 2port 验证，WKC 3/3 |
| SDO、PDO、FoE | 代码路径已接入，尚未在真实从站上验收 |
| 原生 JSON-Lines 模拟核心 | 已编译并通过冒烟测试 |
| PDO 原始字节观察/写入 | SOEM 进程映像已接入，单次最多显示 256 字节 |
| ENI 固定映射 | 仅登记文件路径；PDO 仍使用 SOEM 自动映射 |
| OP 下 SDO/FoE 邮箱 | SOEM cyclic mailbox 路径已接入；尚未在真实从站上验收 |
| Windows 1 ms 周期 | 已内置直方图和报告脚本；尚未在真实拓扑上完成 30 分钟验收 |

当前已验证扫描和 OP；网卡枚举或 OP 成功不代表 SDO、PDO、FoE 或 30 分钟实时性能已经验收。

## 依赖

### 最终用户运行依赖

| 依赖 | 是否必需 | 说明 |
| --- | --- | --- |
| Windows 10/11 x64 | 必需 | 当前正式支持平台 |
| Npcap 运行时 | 物理 SOEM 模式必需 | 提供 `wpcap.dll` 和 NPF 网卡接口；模拟模式不需要 |
| 专用以太网网卡 | 物理模式必需 | 推荐 PCIe 或 USB 3.0 网卡；不要让 TwinCAT 同时占用 |
| SOEM 运行时 | 不需要单独安装 | 已编译进 `ecat-core.exe` |

应用不捆绑 Npcap 安装器或 DLL，因为 Npcap 有独立的再分发许可。最终用户需要自行从 [Npcap 官网](https://npcap.com/#download) 下载安装。建议在安装器中启用 `Install Npcap in WinPcap API-compatible Mode`，当前工作区已使用 Npcap `Packet.dll 1.89` 验证。

安装后可用以下命令确认驱动正在运行：

```powershell
sc.exe query npcap
```

如果 Npcap 安装时启用了“仅管理员访问”，运行 ECAT Bench 时也需要管理员权限。

### Windows 免安装版

从 GitHub Releases 下载 `ECAT-Bench-v0.2.0-win-x64-portable.zip`，完整解压后直接运行
`ECAT Bench.exe`。不需要安装 ECAT Bench，也不需要单独安装 Node.js、CMake 或 SOEM。

- 只使用模拟功能时，解压即可运行。
- 连接真实 EtherCAT 从站前，仍需按上面的说明安装 Npcap 运行时。
- 请勿只从压缩包中拖出主程序运行；原生核心和许可证文件位于应用目录内。
- Release 同时提供源码压缩包和 `SHA256SUMS.txt`，便于核对下载内容。

### 源码构建依赖

| 依赖 | 是否必需 | 说明 |
| --- | --- | --- |
| Node.js 22+、npm 10+ | 必需 | 安装 Electron、React、Vite 等依赖 |
| CMake 3.28+ | 物理后端必需 | SOEM 2.0 要求 CMake 3.28+ |
| MSVC Build Tools 2022/2026 | 二选一 | 安装“使用 C++ 的桌面开发”和 Windows SDK |
| MinGW-w64 GCC 13+ 与 Ninja | 二选一 | 无 MSVC 时的回退构建链，已验证 GCC 13.1 + Ninja |
| Npcap SDK 1.16 | 物理后端编译必需 | 只在构建时使用，最终用户不需要 |
| SOEM v2.0.0 源码 | 已包含 | 位于 `third_party/SOEM`，不需要单独下载 |
| Python 3 | 可选 | 仅在生成应用图标和打包时使用 |

Npcap SDK 可从 [Npcap SDK 1.16](https://npcap.com/dist/npcap-sdk-1.16.zip) 下载。放到项目约定的目录：

```powershell
New-Item -ItemType Directory -Force .cache | Out-Null
Invoke-WebRequest `
  -Uri "https://npcap.com/dist/npcap-sdk-1.16.zip" `
  -OutFile ".cache/npcap-sdk-1.16.zip"
Expand-Archive `
  -LiteralPath ".cache/npcap-sdk-1.16.zip" `
  -DestinationPath ".cache/npcap-sdk" `
  -Force
```

解压后应至少存在：

```text
.cache/npcap-sdk/Include/pcap.h
.cache/npcap-sdk/Lib/x64/wpcap.lib
.cache/npcap-sdk/Lib/x64/Packet.lib
```

`.cache/` 和 `native/build/` 都是本地生成目录，不进入 Git。

如果 PowerShell 报错 `npm.ps1 cannot be loaded because running scripts is disabled`，可把命令中的 `npm` 换成 `npm.cmd`，例如 `npm.cmd run dev`。也可以在确认符合公司安全策略后执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 快速启动

只运行模拟界面：

```powershell
npm install
npm run dev:web
```

物理 SOEM 模式需要先安装 Npcap 运行时、准备 Npcap SDK，然后构建原生核心：

```powershell
npm install
npm run native:build -- `
  -EnableSoem `
  -SoemRoot third_party/SOEM `
  -NpcapRoot .cache/npcap-sdk
npm run test:soem
$env:ECAT_CORE_MODE="soem"
npm run dev
```

启动后确认界面顶部显示 `SOEM` 而不是 `SIM`。浏览器中的 `npm run dev:web` 只使用 TypeScript 模拟核心，不能连接真实从站。

如果原生核心或 Npcap 不可用，Electron 会按 `SOEM -> 原生模拟核心 -> TypeScript 模拟核心` 的顺序回退。需要强制物理模式时设置 `ECAT_CORE_MODE=soem`。

```powershell
$env:ECAT_CORE_MODE="soem"
npm run dev
```

## 构建与测试

```powershell
npm run build
npm test
npm run test:ui
npm run native:build
npm run test:native
```

构建包含 SOEM 的原生核心：

```powershell
npm run native:build -- `
  -EnableSoem `
  -SoemRoot third_party/SOEM `
  -NpcapRoot .cache/npcap-sdk
npm run test:soem
```

`test:soem` 只验证 SOEM 模式启动、网卡枚举和返回结构。真实总线基础验证需设置网卡标识后显式执行：

```powershell
$env:ECAT_SOEM_ADAPTER="Realtek USB GbE Family Controller"
$env:ECAT_CYCLE_US="1000"
$env:ECAT_AUTO_OP="1"
npm run test:hardware
```

`ECAT_AUTO_OP=1` 时会验证从站保持在 `OP` 且 `WKC > 0`。设置 `ECAT_AUTO_OP=0` 可只扫描并停留在 `PRE-OP/SAFE-OP`。该脚本不代表 1 ms 实时性、SDO、PDO 或 FoE 验收通过。

## 1 ms 实时基准

基准测试必须使用真实 SOEM 核心、真实从站、专用网卡和已进入 OP 的总线：

```powershell
$env:ECAT_SOEM_ADAPTER="Realtek PCIe GbE Family Controller"
npm run benchmark:1ms
```

`benchmark:1ms` 运行 60 秒，只用于短时诊断。完整验收入口为：

```powershell
$env:ECAT_SOEM_ADAPTER="Realtek PCIe GbE Family Controller"
npm run benchmark:30m
```

默认报告写入 `artifacts/1ms-benchmark-report.json`，包含周期、收发耗时和绝对调度偏差的 mean/p50/p95/p99/p99.9/max，以及超过 1050/1200/2000 µs、WKC 错误和丢帧计数。报告状态：

- `accepted`：至少 1800 秒、p99 ≤ 1050 µs、p99.9 ≤ 1200 µs、WKC 错误为 0。
- `short-run`：短时运行达到门槛，但不构成 30 分钟验收。
- `failed`：环境缺失、基准未自然完成、样本不足或门槛未达到，命令返回非零退出码。

模拟基准始终标记为 `simulated: true`，判定为不可验收。

## 原生架构

GUI 不直接访问网卡。Electron Renderer 通过安全 preload/IPC 提交命令；Electron Main 启动独立 `ecat-core` 进程，并通过 stdin/stdout 上的 JSON-Lines 交换命令和低频快照。

原生核心启动顺序：

1. `ecat-core --mode soem`
2. `ecat-core --mode sim`
3. TypeScript 模拟核心

SOEM 物理后端使用 `ecx_contextt`、`ecx_init`、`ecx_config_init`、`ecx_config_map_group`、`ecx_configdc`、状态机 API、`ecx_SDO*`、`ecx_FOE*` 和 `ecx_send/receive_processdata`。

周期线程负责 process data 收发、输入快照复制和逐周期基准采样。PDO 写入同时更新 SOEM 输出映像与 GUI 展示快照。总线在 OP 时，SDO/FoE 通过 SOEM cyclic mailbox 推进；周期线程在收发后调用有限步数的 `ecx_mbxhandler`，不再为整个邮箱任务持有粗粒度 I/O 锁。非 OP 或尚未启用 cyclic mailbox 时仍使用阻塞回退路径。

## Windows 打包

不含 SOEM 的默认模拟包：

```powershell
npm run package:win
```

打包使用 `node_modules/electron/dist` 中已安装的 Electron 运行时，不依赖构建时重新访问 GitHub 校验清单。

本项目采用 `GPL-3.0-only`。物理后端包必须显式确认 SOEM 的 GPL 发布模式：

```powershell
$env:ECAT_SOEM_LICENSE_MODE="gpl"
npm run package:win:soem
```

脚本会检查项目许可证、SOEM 与运行时依赖的许可证文本，并确认它们被放入解包应用。发布时应同时提供对应版本的源码包；GPLv3 的完整文本见 [LICENSE](LICENSE)，第三方组件说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Npcap 运行时和 SDK 不随应用打包。最终用户需要单独安装兼容的 Npcap；发布方必须自行确认 Npcap 的再分发和 OEM 条款。

## 目录

```text
src/renderer/          React 操作台
src/main/              Electron 主进程、核心监督与 IPC
src/preload/           安全上下文桥
src/shared/            领域模型、TypeScript 模拟核心、协议辅助
native/soem-core/      独立 C++20 主站核心
scripts/               开发、构建、硬件冒烟与打包脚本
docs/                  需求、架构、协议、测试与打包说明
third_party/           SOEM v2.0.0、nlohmann/json 及其许可证
licenses/              发布包附带的第三方许可证文本
```

## 许可证

ECAT Bench 以 `GPL-3.0-only` 发布。SOEM v2.0.0 通过其 GPLv3 选项链接；Electron、Chromium、React、Lucide 和 nlohmann/json 的许可证文本随应用一同分发。Npcap 不包含在本项目中，用户需遵守 Npcap 自身的许可条款。

版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 关键限制

- EtherCAT 输出会直接驱动真实设备。切换 OP 或写输出前必须确认安全回路、机械边界和驱动器使能条件。
- Windows 是软实时环境。当前实现使用高优先级、CPU 亲和性和 1 ms timer resolution，但不能提供硬实时保证。
- 邮箱与 PDO 的 cyclic mailbox 共存路径已实现，但真实从站、网络驱动和 1 ms 性能仍需硬件验收。
- 原始邮箱帧和 FoE 传输中取消尚未开放；命令会返回明确错误。FoE 下载有进度，上传进度为不确定状态。
- FoE 成功仅代表 SOEM API 返回成功，当前未实现主站侧固件 CRC 校验。
- ENI 目前只登记路径，不解析固定映射、DC 参数或启动序列。
- 模拟模式不会访问物理网卡；界面必须保留 `SIM` 与 `SOEM` 的明确区分。
- `logToDisk` 会在 Electron 用户数据目录写入 JSONL 会话日志；`retainFrames` 当前限制邮箱事务列表，不缓存原始以太网帧。

详细设计见 [需求说明](docs/requirements.md)、[软件架构](docs/architecture.md)、[IPC 协议](docs/protocol.md)、[测试计划](docs/test-plan.md) 和 [打包说明](docs/packaging.md)。
