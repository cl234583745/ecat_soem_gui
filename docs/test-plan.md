# 测试与验收计划

## 1. 自动化测试

### 1.1 TypeScript 单元测试

```powershell
npm test
```

覆盖：

- 对象索引解析与非法输入。
- 状态迁移路径。
- WKC 期望值。
- 扫描后自动 OP。
- SDO 读取、邮箱响应。
- 配置上下限。
- 非 OP 状态拒绝 PDO 写入。

### 1.2 UI 冒烟测试

```powershell
npm run build
npm run test:ui
```

使用系统 Chrome 或 Edge：

- 1480×920 桌面视口。
- 390×844 移动视口。
- 遍历 SDO、PDO、邮箱、FoE、设置页面。
- 捕获控制台错误和页面异常。
- 检查横向溢出。
- 输出截图到 `artifacts/`。

### 1.3 原生核心冒烟测试

```powershell
npm run native:build
npm run test:native
```

覆盖：

- `hello` 握手。
- 启动、扫描、自动 OP。
- 快照返回。
- SDO 读取。
- 邮箱响应。
- 切换 SAFE-OP。
- 基准启动、运行期间操作锁定、停止和 `ioDuration` 字段。
- 停止并释放总线。

### 1.4 SOEM 构建与网卡枚举

```powershell
npm run native:build -- -EnableSoem -SoemRoot third_party/SOEM -NpcapRoot .cache/npcap-sdk
npm run test:soem
```

覆盖：

- SOEM v2 编译与延迟加载 Npcap 运行时。
- 模式和能力握手。
- `ec_find_adapters` 返回 NPF 设备。
- MAC、链路状态和虚拟/无线网卡过滤。

该测试只证明 SOEM 进程和网卡枚举可用，不证明总线扫描或 OP。

### 1.5 基准报告判定

```powershell
npm run test:benchmark
```

覆盖：

- 1800 秒且达到门槛时为 `accepted`。
- 60 秒达到门槛时只能是 `short-run`。
- p99.9 超限时失败并返回非零退出码。
- 请求 30 分钟但提前结束、样本覆盖不足时失败。
- `simulated: true` 永远不能验收为真实 1 ms。

### 1.6 依赖安全

```powershell
npm audit
npm audit --omit=dev
```

发布前必须为 0 个已知漏洞，或对无法升级的项形成书面风险评估。

## 2. 真实硬件测试

### 2.1 环境记录

每次测试必须记录：

- CPU、主板、Windows 版本。
- 网卡型号、驱动、Npcap 版本。
- 从站型号、数量、拓扑顺序、ESI/ENI 版本。
- 主站构建 SHA、SOEM 版本。
- 背景负载和电源策略。

### 2.2 扫描与身份

- 先设置 `ECAT_SOEM_ADAPTER` 并运行 `npm run test:hardware`。
- 扫描 1、2、8、32、128 个从站。
- 检查位置、Vendor ID、Product Code、Revision、Serial。
- 中途拔掉末端从站，确认断点位置。
- 扫描期间热插拔非 EtherCAT 网络设备，确认无干扰。

### 2.3 状态机

- 单站 INIT → PRE-OP → SAFE-OP → OP。
- 单站逐级回退。
- 组切换。
- 一个从站拒绝 OP 时，确认不会显示整组 OP。
- 切换超时与 AL Status code 可视化。

### 2.4 SDO

- 读写 1、2、4、8 字节对象。
- 读写字符串和 OCTET_STRING。
- Complete Access。
- 非法索引、非法长度、从站拒绝访问。
- 连续 10,000 次 SDO 后检查内存和错误计数。

### 2.5 PDO

- 当前版本以 `index=0000` 和字节偏移显示原始输入/输出映像。
- 比对 SOEM `slavelist[n].inputs/outputs` 与界面字节。
- 输入刷新正确。
- 输出写入只影响目标对象。
- 256 字节显示上限之外的偏移不被 UI 列出。
- 断链时 WKC 和输出安全行为正确。
- 混合状态时不得显示 OP。

### 2.6 FoE

- 1 MB、8 MB、64 MB 固件。
- 正确密码、错误密码、无密码。
- 传输中断、总线断开、从站重启。
- 固件版本扫描确认。
- 从站侧升级确认和版本回读。
- 当前主站侧不执行 FoE CRC；在实现前不得把 SOEM API 返回成功表述为 CRC 校验通过。

## 3. 1 ms 实时性测试

### 3.1 采集

核心记录每个周期：

- 单调时钟时间戳。
- 等待到绝对目标时刻后的调度偏差。
- 发送/接收耗时。
- 周期间隔。
- WKC。
- 超时和丢帧。

测试至少 30 分钟，建议 8 小时。

也可以由脚本执行：

```powershell
$env:ECAT_SOEM_ADAPTER="Realtek PCIe GbE Family Controller"
npm run benchmark:1ms
npm run benchmark:30m
```

60 秒运行只用于短时诊断，不能替代 30 分钟验收。默认报告位于 `artifacts/1ms-benchmark-report.json`。

### 3.2 报告

报告必须包含：

- 平均、p50、p95、p99、p99.9、最大值。
- 周期时间、收发耗时和绝对调度偏差三组分布。
- 超过 1050 µs、1200 µs、2000 µs 的次数。
- WKC 错误和丢帧率。
- CPU 占用、线程迁移、DPC/ISR 延迟参考。
- 背景负载条件。

### 3.3 建议门槛

- p99 ≤ 1050 µs。
- p99.9 ≤ 1200 µs。
- 无持续 WKC 错误。
- 至少 90% 的预期周期样本被记录。
- 连续 30 分钟无核心崩溃。

报告状态必须为 `accepted` 才能声明 30 分钟 1 ms 验收通过。`short-run` 只表示短时门槛达到，`failed` 时命令返回非零退出码。任何情况下都不得把 Windows 调度描述为硬实时。

## 4. 故障注入

- 核心进程被强制结束：GUI 显示离线，网卡释放后允许重启。
- GUI 刷新期间核心持续周期：周期统计无异常尖峰。
- 配置 JSON 损坏：回退默认值。
- 文件不存在、无权限、磁盘满。
- 网卡被禁用或被其他进程占用。
- 扫描过程中关闭应用。

## 5. 发布前检查

- `npm run audit`
- `npm run typecheck`
- `npm test`
- `npm run test:benchmark`
- `npm run build`
- `npm run test:ui`
- `npm run test:electron`
- `npm run native:build -- -EnableSoem -SoemRoot third_party/SOEM -NpcapRoot .cache/npcap-sdk`
- `npm run test:native`
- `npm run test:soem`
- `npm run package:win`
- `npm run test:packaged`
- 安装包在干净 Windows 虚拟机启动。
- 无管理员权限与有管理员权限分别测试网卡访问。
- 检查第三方许可证、Npcap 安装流程和代码签名。
- 有真实从站时另行执行 30 分钟基准并归档 `accepted` 报告；没有硬件时发布说明必须明确该项未验收。
