# 打包与发布

## 1. 构建依赖

- Node.js 22+、npm 10+
- Visual Studio Build Tools 2022/2026，或 MinGW-w64 GCC 13+ 与 Ninja
- MSVC x64 与 Windows 10/11 SDK（仅 MSVC 构建）
- CMake 3.28+
- Python（仅图标生成）
- Npcap SDK（仅物理后端）
- SOEM v2.0.0 源码（已包含在 `third_party/SOEM`）

当前已验证环境：

- Node.js 24.16.0
- npm 11.13.0
- MinGW-w64 GCC 13.1.0 与 Ninja
- CMake 4.1.0
- Npcap SDK 1.16（运行时为 Npcap 1.89）
- SOEM v2.0.0，commit `304d1c05eab77dc0d426f1a5cf09c8cc7dc03713`

## 2. 默认模拟包

```powershell
npm install
npm run package:win
```

执行流程：

1. 生成应用图标。
2. 构建 Renderer 与 Electron Main。
3. 构建不含 SOEM 的原生核心。
4. 生成 `release/win-unpacked/`。
5. 生成 NSIS 安装包和 Portable 包。

主要产物：

- `dist/`：Renderer 静态资源。
- `dist-electron/`：Electron Main 与 Preload。
- `native/build/bin/ecat-core.exe`：原生核心。
- `release/`：安装包与 Portable 包。

Electron Builder 将核心放入 `resources/native/ecat-core.exe`。Main 进程在 `app.isPackaged` 时从该路径启动。

会话日志在最终用户的 Electron 用户数据目录中写为 `ecat-bench-session.jsonl`。该文件不进入安装包；只有配置开启 `logToDisk` 时才追加。

## 3. SOEM 物理包

先准备本地依赖：

```text
third_party/SOEM/     SOEM v2.0.0
.cache/npcap-sdk/     Npcap SDK
```

Npcap SDK 下载和解压方式见 [README 依赖章节](../README.md#依赖)。SDK 只用于构建；最终用户仍需自行安装 Npcap 运行时。

本项目以 `GPL-3.0-only` 发布，物理包使用 SOEM 的 GPLv3 选项。显式确认发布模式：

```powershell
$env:ECAT_SOEM_LICENSE_MODE="gpl"
npm run package:win:soem
```

脚本会：

1. 拒绝未设置 `gpl` 许可模式的构建。
2. 检查项目 `GPL-3.0-only` 声明、完整 GPL 文本和所有第三方许可证文件。
3. 构建 Renderer。
4. 使用 SOEM 和 Npcap SDK 构建原生核心。
5. 生成解包应用、NSIS 与 Portable 包。
6. 验证许可证和说明文件已进入解包应用。
7. 写入 `artifacts/soem-package-manifest.json`，记录项目版本、许可模式、SOEM commit 和 SDK 路径。

只生成解包目录：

```powershell
$env:ECAT_SOEM_LICENSE_MODE="gpl"
powershell -ExecutionPolicy Bypass -File scripts/package-soem.ps1 -DirectoryOnly
```

## 4. Npcap 运行时

应用不打包 Npcap。`ecat-core.exe` 按以下顺序查找 `wpcap.dll`：

1. `ECAT_NPCAP_DIR`
2. `ecat-core.exe` 同目录
3. `C:\Windows\System32\Npcap`
4. 系统默认 DLL 搜索路径

构建采用 `/DELAYLOAD:wpcap.dll`，因此模拟核心可在未全局配置 Npcap PATH 的机器上启动。

发布方必须：

- 在安装说明中要求用户安装兼容 Npcap。
- 不默认捆绑 Npcap 安装器或 DLL。
- 在使用 OEM 再分发授权时遵守 Npcap 条款。
- 在网卡枚举为空时提示检查 Npcap、管理员权限和接口状态。

## 5. 项目与 SOEM 许可

ECAT Bench 使用 `GPL-3.0-only`。SOEM v2.0.0 为 GPLv3/商业双许可，本项目通过其 GPLv3 选项链接和分发。发布物理包时必须同时提供对应 tag 的完整源码，GitHub Release 中应包含源码压缩包。

### GPL 模式

- 项目许可证为 `GPL-3.0-only`。
- 必须向接收者提供完整对应源码和构建方式。
- 必须保留 SOEM 版权与许可证文本。
- 必须随应用分发 Electron、Chromium、React、Lucide 和 nlohmann/json 的许可证文本。
- Npcap 不随应用分发，最终用户自行安装并遵守 Npcap 条款。

### 商业模式

当前公开发布不使用商业模式。若未来需要闭源分发，必须取得 RT-Labs 的适用商业许可，并重新审查整个项目的许可证，不能仅修改打包脚本中的许可模式。

## 6. 依赖安全

```powershell
npm run audit
npm run audit:prod
```

2026-10-27 已在升级到 Electron 45、electron-builder 26.18、Vite 8 和 Vitest 5 后取得 0 个已知 npm 漏洞。每次发布仍需重新执行审计。

## 7. 实时基准报告

物理包不能代替硬件验收。打包完成后，在目标机、专用网卡和真实拓扑上执行：

```powershell
$env:ECAT_SOEM_ADAPTER="Realtek PCIe GbE Family Controller"
npm run benchmark:30m
```

默认报告写入 `artifacts/1ms-benchmark-report.json`。只有状态为 `accepted` 且命令退出码为 0 才能归档为 30 分钟验收记录。`short-run` 可用于开发诊断，`failed` 会返回非零退出码。报告与安装包分开保存，不应把模拟基准或 60 秒短测描述为真实 1 ms 认证。

## 8. 代码签名

当前未配置签名。正式发布建议：

- 使用 EV 或 OV Windows 代码签名证书。
- 同时签名 `ecat-core.exe`、Electron 主程序和安装包。
- 使用受信任 timestamp server。
- 在干净 Windows 虚拟机验证 SmartScreen、安装、升级和卸载。

## 9. 发布检查

```powershell
npm run audit
npm run build
npm test
npm run test:benchmark
npm run native:build
npm run test:native
npm run test:ui
npm run test:electron
npm run package:win
npm run test:packaged
```

物理包另需：

```powershell
$env:ECAT_SOEM_LICENSE_MODE="gpl"
npm run package:win:soem
```

打包后验证：

```powershell
npm run native:build -- -EnableSoem -SoemRoot third_party/SOEM -NpcapRoot .cache/npcap-sdk
npm run test:soem
npm run test:packaged
```

发布时还应生成源码压缩包和 `SHA256SUMS.txt`。真实硬件、1 ms 实时性、SDO、PDO 和 FoE 必须按 [测试计划](test-plan.md) 单独验收，不能用安装包冒烟测试代替。

`v0.2.0` 的 Release 资产命名：

- `ECAT-Bench-v0.2.0-win-x64-portable.zip`
- `ECAT-Bench-v0.2.0-source.zip`
- `SHA256SUMS.txt`

## 10. 跨平台

使用各平台原生 CI runner：

- Windows：NSIS + Portable。
- Linux：AppImage + deb，附 libpcap 和 realtime 权限说明。
- macOS：dmg，处理 BPF 权限、公证、arm64/x64。

不要依赖 Windows runner 交叉打包 Linux/macOS 原生核心。
