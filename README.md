# ECAT Bench

紧凑型 EtherCAT 主站调试台。目标是把网卡选择、从站扫描、状态机、SDO/PDO、邮箱诊断和 FoE 固件维护放进一个类似串口调试助手的桌面工具，而不是完整的 PLC 工程平台。

## 当前状态

| 模块 | 状态 |
| --- | --- |
| React/Electron 桌面操作台 | 可运行 |
| Electron 主进程与原生核心 | SOEM 优先，失败后回退原生模拟核心或 TypeScript 模拟核心 |
| SOEM v2 物理后端 | 已编译；NPF 网卡枚举已通过 |
| 真实从站扫描、OP、SDO、PDO、FoE | 代码路径已接入，尚未在真实从站上验收 |
| 原生 JSON-Lines 模拟核心 | 已编译并通过冒烟测试 |
| PDO 原始字节观察/写入 | SOEM 进程映像已接入，单次最多显示 256 字节 |
| ENI 固定映射 | 仅登记文件路径；PDO 仍使用 SOEM 自动映射 |
| OP 下 SDO/FoE 邮箱 | SOEM cyclic mailbox 路径已接入；尚未在真实从站上验收 |
| Windows 1 ms 周期 | 已内置直方图和报告脚本；尚未在真实拓扑上完成 30 分钟验收 |

当前工作区没有已知的真实 EtherCAT 从站。网卡枚举成功不等于 OP、SDO、PDO 或 FoE 已通过真实硬件验证。

## 快速启动

环境要求：

- Node.js 22+、npm 10+
- Windows 10/11 x64
- Visual Studio Build Tools 2022/2026、Windows SDK、CMake 3.24+
- 物理后端另需 Npcap 运行时、Npcap SDK 和 SOEM v2 源码

```powershell
npm install
npm run dev
```

浏览器模式只使用 TypeScript 模拟核心：

```powershell
npm run dev:web
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
$env:ECAT_SOEM_ADAPTER="Realtek PCIe GbE Family Controller"
$env:ECAT_CYCLE_US="1000"
npm run test:hardware
```

该脚本只执行扫描并报告从站与状态，不代表 1 ms 实时性、OP、SDO 或 FoE 验收通过。

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

物理后端包必须显式声明 SOEM 许可模式：

```powershell
$env:ECAT_SOEM_LICENSE_MODE="commercial"
npm run package:win:soem
```

也可设置为 `gpl`，但必须同时满足 GPLv3 的完整对应源码与项目许可证要求。SOEM v2.0.0 为 GPLv3/商业双许可，项目当前仍标记为 `UNLICENSED`，不能未经决策直接公开发布物理后端包。

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
```

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
