# 原生核心 IPC 协议

原生核心使用 stdin/stdout 上的 JSON-Lines。每行必须是完整 JSON 对象。诊断信息写入 stderr，stdout 只承载协议消息。

## 1. 启动

```powershell
ecat-core.exe --mode sim
ecat-core.exe --mode soem
```

`sim` 不访问硬件。`soem` 仅在 `ECAT_HAS_SOEM` 构建中存在，并在 Windows 上要求可加载的 Npcap 运行时。

## 2. 请求与响应

请求：

```json
{"id":"request-1","command":"get_snapshot","params":{}}
```

响应：

```json
{
  "type": "response",
  "id": "request-1",
  "ok": true,
  "message": "Snapshot",
  "data": {}
}
```

- `id` 可以是字符串或数字，响应原样返回。
- 失败时 `ok=false`，`message` 提供可显示的错误。
- 未知命令返回失败响应，不改变核心状态。

## 3. 快照事件

```json
{
  "type": "event",
  "event": "snapshot",
  "data": {}
}
```

当前事件周期约 100 ms。Renderer 必须限制 DOM 更新成本，不得按周期线程速率更新。

## 4. 命令

### hello

返回版本、模式、能力和初始化状态。

### get_snapshot

返回主站阶段、网卡、从站、遥测、日志、FoE 状态、实时基准、配置和能力。

SOEM PDO 数据当前使用原始字节视图：

```json
{
  "index": "0000",
  "subIndex": 0,
  "name": "Output byte 0",
  "type": "UINT8",
  "value": "0x00",
  "writable": true,
  "offset": 0
}
```

每个从站最多暴露 256 个输入字节和 256 个输出字节。`subIndex` 是相对于该从站方向的字节偏移。

### list_adapters

返回 SOEM/Npcap 可用的 NPF 网卡：

```json
[
  {
    "id": "\\Device\\NPF_{GUID}",
    "name": "Realtek PCIe GbE Family Controller",
    "description": "\\Device\\NPF_{GUID}",
    "mac": "00:11:22:33:44:55",
    "linkUp": true,
    "driver": "Npcap / NPF",
    "dedicated": true
  }
]
```

### select_adapter / select_slave

```json
{"adapterId":"\\Device\\NPF_{GUID}"}
```

```json
{"slaveIndex":1}
```

运行中禁止切换网卡。

### update_config

```json
{
  "config": {
    "adapterId": "\\Device\\NPF_{GUID}",
    "cycleUs": 1000,
    "sendTimeoutUs": 2000,
    "receiveTimeoutUs": 2000,
    "autoTransitionOp": true,
    "distributedClock": true,
    "realtimePriority": true,
    "dedicatedCore": 2,
    "eniPath": "",
    "logToDisk": true,
    "retainFrames": 5000
  }
}
```

`cycleUs` 当前限制为 250 至 10000，`retainFrames` 限制为 100 至 100000。运行中禁止改变周期，基准运行期间禁止修改配置。

`logToDisk` 由 Electron Main 执行：核心通过快照发布会话日志，Main 在用户数据目录去重后追加 JSONL。`retainFrames` 当前限制界面的邮箱事务列表长度，不缓存原始以太网帧。

### load_eni

```json
{"filePath":"C:\\config\\line.eni"}
```

当前只验证文件并登记路径，返回：

```json
{
  "path": "C:\\config\\line.eni",
  "mappingApplied": false
}
```

ENI 解析、固定映射、DC 参数和启动序列尚未实现。

### start / stop / scan

```json
{
  "adapterId": "\\Device\\NPF_{GUID}",
  "cycleUs": 1000,
  "autoTransitionOp": true
}
```

```json
{"command":"stop","params":{}}
```

```json
{"command":"scan","params":{}}
```

扫描执行 `ecx_config_init`、`ecx_config_map_group` 和可选 `ecx_configdc`。若启用 `autoTransitionOp`，扫描后请求 OP。

### transition / transition_all

```json
{"slaveIndex":1,"target":"SAFE-OP"}
```

```json
{"target":"OP"}
```

目标状态：`INIT`、`PRE-OP`、`SAFE-OP`、`OP`。

### sdo_read / sdo_write

```json
{
  "slaveIndex": 1,
  "index": "6041",
  "subIndex": "00",
  "completeAccess": false
}
```

```json
{
  "slaveIndex": 1,
  "index": "6040",
  "subIndex": "00",
  "valueHex": "0F00",
  "completeAccess": false
}
```

SOEM 返回值会转换为 `valueHex`、`valueDecimal` 和 `elapsedUs`。

### write_pdo

```json
{
  "slaveIndex": 1,
  "index": "0000",
  "subIndex": "00",
  "value": "0x0F"
}
```

- 仅支持 `index=0000` 的原始输出字节。
- `subIndex` 是该从站输出字节偏移，范围为 `00` 至 `FF`。
- `value` 必须是一个十六进制字节。
- 总线必须处于 OP。
- 符号 PDO 对象和 ENI 映射尚未实现，其他索引会返回明确错误。

### mailbox

```json
{
  "slaveIndex": 1,
  "protocol": "CoE",
  "payloadHex": "4000416000000000"
}
```

SOEM 后端尚未开放任意原始邮箱帧，命令返回明确错误。请使用 SDO 或 FoE 专用命令。

### foe_start / foe_cancel

```json
{
  "direction": "download",
  "filePath": "C:\\firmware\\servo.bin",
  "fileName": "servo.bin",
  "password": 0
}
```

- `direction` 为 `download` 或 `upload`。
- 下载最多 64 MiB；上传缓冲区同样限制为 64 MiB。
- OP 下 SOEM FoE 通过 cyclic mailbox 推进；非 OP 路径使用阻塞式调用。
- 下载回调提供剩余字节并可换算完成百分比；上传进度不可精确计算，`progressAvailable=false`。
- 当前主站侧不执行固件 CRC 校验；成功仅表示 SOEM API 返回成功。
- 传输中取消当前不支持，`foe_cancel` 返回明确错误。

### benchmark_start / benchmark_stop

```json
{"durationSec":1800}
```

```json
{"command":"benchmark_stop","params":{}}
```

真实核心要求总线已进入 OP，时长范围为 10 秒至 8 小时。模拟核心允许 1 秒起，便于自动化测试，但结果带有 `simulated: true`。基准运行期间扫描、状态切换、SDO、PDO 写入、FoE、配置修改和 ENI 加载会返回失败。

快照中的基准结构：

```json
{
  "benchmark": {
    "status": "running",
    "durationSec": 1800,
    "elapsedSec": 120.5,
    "samples": 120500,
    "cycleTime": {
      "meanUs": 1000.4,
      "p50Us": 999,
      "p95Us": 1010,
      "p99Us": 1024,
      "p999Us": 1130,
      "maxUs": 1480
    },
    "ioDuration": {
      "meanUs": 236,
      "p50Us": 202,
      "p95Us": 412,
      "p99Us": 640,
      "p999Us": 890,
      "maxUs": 1210
    },
    "scheduleJitter": {
      "meanUs": 12,
      "p50Us": 8,
      "p95Us": 24,
      "p99Us": 35,
      "p999Us": 72,
      "maxUs": 140
    },
    "over1050": 12,
    "over1200": 3,
    "over2000": 0,
    "wkcErrors": 0,
    "lostFrames": 0,
    "startedAt": 1780000000000,
    "completedAt": 0
  }
}
```

`cycleTime` 是实际相邻周期起点间隔；`ioDuration` 是发送、接收、邮箱步骤和输入快照的耗时；`scheduleJitter` 是相对绝对目标时刻的绝对调度误差。示例数字仅说明字段结构。

`scripts/realtime-benchmark.mjs` 只有在基准自然完成且数据不是模拟值时才可能输出 `accepted`。短于 1800 秒的运行最多为 `short-run`；门槛不满足、样本覆盖率低于 90% 或运行异常时报告为 `failed` 并返回非零退出码。

## 5. 兼容策略

- 新增字段必须向后兼容。
- 删除字段或改变语义必须提升协议版本。
- UI 应忽略未知快照字段。
- 命令失败不得假定核心已部分改变状态，除非响应或快照明确说明。
