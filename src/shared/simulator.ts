import {
  expectedWorkingCounter,
  limitHistory,
  parseEthercatIndex,
  transitionPath
} from "./protocol";
import { formatHex } from "./format";
import type {
  CommandResult,
  EcatAdapter,
  EcatSlave,
  FoeFileInfo,
  LogEntry,
  LogLevel,
  MailboxRequest,
  MailboxResult,
  MasterConfig,
  PdoEntry,
  RealtimeBenchmark,
  RealtimeBenchmarkStatus,
  SdoRequest,
  SdoResult,
  SlaveState,
  Snapshot,
  TelemetryPoint
} from "./types";

const APP_VERSION = "0.1.0";

const SIM_ADAPTERS: EcatAdapter[] = [
  {
    id: "npf:intel-i219",
    name: "Intel I219-LM",
    description: "板载千兆以太网 · EtherCAT 专用口",
    mac: "3C:7C:3F:8A:21:10",
    linkUp: true,
    driver: "NPCAP / NPF",
    dedicated: true
  },
  {
    id: "npf:realtek-usb",
    name: "Realtek USB GbE",
    description: "USB 3.0 千兆网卡 · 可用于临时调试",
    mac: "00:E0:4C:68:42:7B",
    linkUp: true,
    driver: "NPCAP / NPF",
    dedicated: true
  },
  {
    id: "npf:ethernet-2",
    name: "Ethernet 2",
    description: "Hyper-V 虚拟交换机 · 不建议用于实时主站",
    mac: "00:15:5D:21:7A:03",
    linkUp: false,
    driver: "NDIS",
    dedicated: false
  }
];

interface SimulatorOptions {
  autoTick?: boolean;
  latencyScale?: number;
  useDemoBus?: boolean;
  now?: () => number;
}

const objectValue = (index: string, subIndex: number): string => {
  const key = `${index.toUpperCase()}:${formatHex(subIndex, 2)}`;
  const values: Record<string, string> = {
    "6041:00": "0237",
    "6040:00": "000F",
    "6064:00": "000F4240",
    "606C:00": "00000000",
    "6077:00": "00000025",
    "2000:00": "00001234",
    "2001:01": "00000064",
    "6000:00": "00000001"
  };
  return values[key] ?? "00000000";
};

function demoSlaves(): EcatSlave[] {
  return [
    {
      index: 1,
      name: "AM8121 伺服驱动器",
      vendorId: "0x0000066F",
      productCode: "0x0000A812",
      revision: "0x01000003",
      serial: "SIM-4E1A-0218",
      state: "OP",
      alStatus: 0x0008,
      alStatusCode: "OP",
      wkc: 3,
      dcEnabled: true,
      mailboxProtocols: ["CoE", "FoE"],
      inputs: [
        {
          index: "0x6041",
          subIndex: 0,
          name: "Statusword",
          type: "UINT16",
          value: "0x0237",
          writable: false
        },
        {
          index: "0x6064",
          subIndex: 0,
          name: "Position actual",
          type: "INT32",
          value: "1000000",
          unit: "inc",
          writable: false
        },
        {
          index: "0x6077",
          subIndex: 0,
          name: "Torque actual",
          type: "INT16",
          value: "37",
          unit: "0.1%",
          writable: false
        }
      ],
      outputs: [
        {
          index: "0x6040",
          subIndex: 0,
          name: "Controlword",
          type: "UINT16",
          value: "0x000F",
          writable: true
        },
        {
          index: "0x607A",
          subIndex: 0,
          name: "Target position",
          type: "INT32",
          value: "1000000",
          unit: "inc",
          writable: true
        },
        {
          index: "0x60FF",
          subIndex: 0,
          name: "Target velocity",
          type: "INT32",
          value: "0",
          unit: "inc/s",
          writable: true
        }
      ]
    },
    {
      index: 2,
      name: "EC8-DIO 远程 I/O",
      vendorId: "0x00000ACE",
      productCode: "0x00001008",
      revision: "0x00020001",
      serial: "SIM-IO-0084",
      state: "OP",
      alStatus: 0x0008,
      alStatusCode: "OP",
      wkc: 3,
      dcEnabled: true,
      mailboxProtocols: ["CoE", "FoE"],
      inputs: [
        {
          index: "0x6000",
          subIndex: 1,
          name: "Digital input",
          type: "BYTE",
          value: "0xA5",
          writable: false
        },
        {
          index: "0x6000",
          subIndex: 2,
          name: "Input filter",
          type: "UINT16",
          value: "3",
          unit: "ms",
          writable: false
        }
      ],
      outputs: [
        {
          index: "0x7000",
          subIndex: 1,
          name: "Digital output",
          type: "BYTE",
          value: "0x3C",
          writable: true
        }
      ]
    },
    {
      index: 3,
      name: "ABS-24 绝对值编码器",
      vendorId: "0x00000A77",
      productCode: "0x00002401",
      revision: "0x00010006",
      serial: "SIM-ENC-1190",
      state: "OP",
      alStatus: 0x0008,
      alStatusCode: "OP",
      wkc: 3,
      dcEnabled: true,
      mailboxProtocols: ["CoE"],
      inputs: [
        {
          index: "0x6000",
          subIndex: 0,
          name: "Position",
          type: "UINT32",
          value: "482190",
          unit: "inc",
          writable: false
        },
        {
          index: "0x6001",
          subIndex: 0,
          name: "Status",
          type: "BYTE",
          value: "0x01",
          writable: false
        }
      ],
      outputs: []
    },
    {
      index: 4,
      name: "GW-EC 协议网关",
      vendorId: "0x00000B12",
      productCode: "0x00000120",
      revision: "0x00030000",
      serial: "SIM-GW-0402",
      state: "OP",
      alStatus: 0x0008,
      alStatusCode: "OP",
      wkc: 3,
      dcEnabled: false,
      mailboxProtocols: ["CoE", "EoE", "FoE"],
      inputs: [
        {
          index: "0x6000",
          subIndex: 1,
          name: "Gateway status",
          type: "UINT16",
          value: "0x0001",
          writable: false
        }
      ],
      outputs: [
        {
          index: "0x7000",
          subIndex: 1,
          name: "Gateway command",
          type: "UINT16",
          value: "0x0000",
          writable: true
        }
      ]
    }
  ];
}

function buildInitialConfig(adapterId: string): MasterConfig {
  return {
    adapterId,
    cycleUs: 1000,
    sendTimeoutUs: 2000,
    receiveTimeoutUs: 2000,
    autoTransitionOp: true,
    distributedClock: true,
    realtimePriority: true,
    dedicatedCore: 2,
    eniPath: "",
    logToDisk: true,
    retainFrames: 5000
  };
}

function initialTelemetry(now: number, slaves: EcatSlave[]): TelemetryPoint {
  return {
    at: now,
    cycleUs: 1000,
    jitterUs: 12,
    wkc: expectedWorkingCounter(slaves.length),
    expectedWkc: expectedWorkingCounter(slaves.length),
    lostFrames: 0,
    dcOffsetNs: 84
  };
}

function initialHistory(
  now: number,
  slaves: EcatSlave[],
  points = 90
): TelemetryPoint[] {
  const expected = expectedWorkingCounter(slaves.length);
  return Array.from({ length: points }, (_, index) => {
    const wave = Math.sin(index / 8) * 5 + Math.cos(index / 17) * 3;
    return {
      at: now - (points - index) * 500,
      cycleUs: Math.round(1000 + wave),
      jitterUs: Math.max(2, Math.round(11 + Math.abs(wave))),
      wkc: expected,
      expectedWkc: expected,
      lostFrames: 0,
      dcOffsetNs: Math.round(65 + Math.sin(index / 12) * 28)
    };
  });
}

function simulatedBenchmark(
  status: RealtimeBenchmarkStatus,
  durationSec: number,
  elapsedSec: number,
  cycleUs: number,
  startedAt: number,
  completedAt = 0
): RealtimeBenchmark {
  const samples = Math.max(
    0,
    Math.floor((elapsedSec * 1_000_000) / Math.max(1, cycleUs))
  );
  return {
    status,
    durationSec,
    elapsedSec,
    samples,
    cycleTime: {
      meanUs: cycleUs + 1,
      p50Us: Math.max(0, cycleUs - 1),
      p95Us: cycleUs + 2,
      p99Us: cycleUs + 8,
      p999Us: cycleUs + 25,
      maxUs: cycleUs + 80
    },
    ioDuration: {
      meanUs: Math.max(1, Math.round(cycleUs / 4)),
      p50Us: Math.max(1, Math.round(cycleUs / 5)),
      p95Us: Math.max(1, Math.round(cycleUs / 3)),
      p99Us: Math.max(1, Math.round(cycleUs / 2.5)),
      p999Us: Math.max(1, Math.round(cycleUs / 2)),
      maxUs: Math.max(1, Math.round(cycleUs / 1.5))
    },
    scheduleJitter: {
      meanUs: 9,
      p50Us: 4,
      p95Us: 8,
      p99Us: 13,
      p999Us: 28,
      maxUs: 74
    },
    over1050: cycleUs > 1050 ? samples : 0,
    over1200: cycleUs > 1200 ? samples : 0,
    over2000: cycleUs > 2000 ? samples : 0,
    lostFrames: 0,
    wkcErrors: 0,
    startedAt,
    completedAt,
    simulated: true
  };
}

export class CoreSimulator {
  private snapshot: Snapshot;
  private readonly listeners = new Set<(snapshot: Snapshot) => void>();
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private transferTimer: ReturnType<typeof setInterval> | null = null;
  private readonly latencyScale: number;
  private readonly autoTick: boolean;
  private readonly now: () => number;
  private idCounter = 0;
  private startedAt: number;
  private benchmarkStartedAt = 0;
  private benchmarkDurationSec = 0;
  private benchmarkCompletionLogged = false;

  constructor(options: SimulatorOptions = {}) {
    const now = options.now ?? Date.now;
    const useDemoBus = options.useDemoBus ?? true;
    this.now = now;
    this.latencyScale = options.latencyScale ?? 1;
    this.autoTick = options.autoTick !== false;
    this.startedAt = now();
    const slaves = useDemoBus ? demoSlaves() : [];
    const telemetry = initialTelemetry(this.startedAt, slaves);
    const config = buildInitialConfig(SIM_ADAPTERS[0].id);

    this.snapshot = {
      version: APP_VERSION,
      mode: "simulator",
      phase: useDemoBus ? "op" : "offline",
      connected: useDemoBus,
      scanning: false,
      adapters: SIM_ADAPTERS,
      selectedAdapterId: config.adapterId,
      slaves,
      selectedSlaveIndex: slaves[0]?.index ?? 0,
      telemetry,
      history: initialHistory(this.startedAt, slaves),
      counters: {
        cycles: 184_260,
        lostFrames: 0,
        mailboxErrors: 0,
        workingCounterErrors: 0,
        uptimeSec: 184
      },
      logs: [
        this.makeLog(
          "success",
          "MASTER",
          "演示总线已进入 OP，周期数据交换正常",
          this.startedAt - 2_000
        ),
        this.makeLog(
          "info",
          "SCAN",
          "扫描完成：发现 4 个从站，WKC 5/5",
          this.startedAt - 3_200
        ),
        this.makeLog(
          "info",
          "ADAPTER",
          "已绑定 Intel I219-LM，链路速率 1 Gbps",
          this.startedAt - 4_100
        ),
        this.makeLog(
          "info",
          "CORE",
          "模拟核心启动，未访问物理网卡",
          this.startedAt - 4_800
        )
      ],
      benchmark: simulatedBenchmark(
        "idle",
        0,
        0,
        config.cycleUs,
        0
      ),
      transfer: {
        active: false,
        direction: "download",
        fileName: "",
        progress: 0,
        progressAvailable: false,
        bytesCompleted: 0,
        bytesTotal: 0,
        status: "idle",
        message: "等待选择固件文件"
      },
      config,
      capabilities: {
        hardware: false,
        eniImport: true,
        eoe: true,
        foe: true
      }
    };

    if (options.autoTick !== false) {
      this.startTicker();
    }
  }

  getSnapshot(): Snapshot {
    return structuredClone(this.snapshot);
  }

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  listAdapters(): EcatAdapter[] {
    return structuredClone(this.snapshot.adapters);
  }

  async selectAdapter(adapterId: string): Promise<CommandResult> {
    if (!this.snapshot.adapters.some((adapter) => adapter.id === adapterId)) {
      return { ok: false, message: "未找到指定网卡" };
    }
    if (this.snapshot.connected) {
      return { ok: false, message: "请先停止总线再切换网卡" };
    }
    this.patch({
      selectedAdapterId: adapterId,
      config: { ...this.snapshot.config, adapterId }
    });
    this.log("info", "ADAPTER", `已选择 ${this.adapterName(adapterId)}`);
    return { ok: true, message: "网卡已选择" };
  }

  async connect(adapterId: string): Promise<CommandResult> {
    if (this.snapshot.connected) {
      return { ok: false, message: "总线已经启动" };
    }
    if (!this.snapshot.adapters.some((adapter) => adapter.id === adapterId)) {
      return { ok: false, message: "未找到指定网卡" };
    }

    this.patch({ phase: "connecting", selectedAdapterId: adapterId });
    this.log("info", "MASTER", `正在初始化 ${this.adapterName(adapterId)}`);
    await this.delay(360);
    this.startedAt = this.now();
    this.patch({
      connected: true,
      phase: "preop",
      slaves: [],
      selectedSlaveIndex: 0,
      telemetry: initialTelemetry(this.now(), []),
      history: [],
      config: { ...this.snapshot.config, adapterId },
      counters: {
        ...this.snapshot.counters,
        cycles: 0,
        lostFrames: 0,
        workingCounterErrors: 0,
        uptimeSec: 0
      }
    });
    this.log("success", "MASTER", "主站已初始化，从站处于 PRE-OP");
    return { ok: true, message: "总线已启动" };
  }

  async disconnect(): Promise<CommandResult> {
    this.stopTicker();
    this.cancelTransferInternal();
    const abortedBenchmark =
      this.snapshot.benchmark.status === "running"
        ? {
            ...this.snapshot.benchmark,
            status: "aborted" as const,
            completedAt: this.now()
          }
        : this.snapshot.benchmark;
    this.patch({
      connected: false,
      scanning: false,
      phase: "offline",
      slaves: [],
      selectedSlaveIndex: 0,
      history: [],
      telemetry: initialTelemetry(this.now(), []),
      benchmark: abortedBenchmark,
      transfer: {
        active: false,
        direction: "download",
        fileName: "",
        progress: 0,
        progressAvailable: false,
        bytesCompleted: 0,
        bytesTotal: 0,
        status: "idle",
        message: "等待选择固件文件"
      }
    });
    this.log("warning", "MASTER", "总线已停止，网卡已释放");
    return { ok: true, message: "总线已停止" };
  }

  async scan(): Promise<CommandResult<number>> {
    const benchmarkGuard = this.rejectDuringBenchmark<number>("扫描");
    if (benchmarkGuard) {
      return benchmarkGuard;
    }
    if (!this.snapshot.connected) {
      const connected = await this.connect(this.snapshot.selectedAdapterId);
      if (!connected.ok) {
        return { ok: false, message: connected.message };
      }
    }
    if (this.snapshot.scanning) {
      return { ok: false, message: "扫描正在进行" };
    }

    this.patch({ scanning: true });
    this.log("info", "SCAN", "开始扫描 EtherCAT 从站");
    await this.delay(620);
    const slaves = demoSlaves().map((slave) => ({
      ...slave,
      state: "PRE-OP" as SlaveState,
      alStatus: 0x0002,
      alStatusCode: "PRE-OP"
    }));
    this.patch({
      scanning: false,
      slaves,
      selectedSlaveIndex: slaves[0]?.index ?? 0,
      phase: "preop",
      telemetry: {
        ...this.snapshot.telemetry,
        wkc: 0,
        expectedWkc: expectedWorkingCounter(slaves.length)
      }
    });
    this.log(
      "success",
      "SCAN",
      `扫描完成：发现 ${slaves.length} 个从站，拓扑无断点`
    );

    if (this.snapshot.config.autoTransitionOp) {
      await this.transitionAll("OP");
    }
    return {
      ok: true,
      message: `发现 ${slaves.length} 个从站`,
      data: slaves.length
    };
  }

  async selectSlave(index: number): Promise<CommandResult> {
    if (!this.snapshot.slaves.some((slave) => slave.index === index)) {
      return { ok: false, message: "从站不存在" };
    }
    this.patch({ selectedSlaveIndex: index });
    return { ok: true, message: "已选从站" };
  }

  async transitionSlave(
    index: number,
    target: SlaveState
  ): Promise<CommandResult> {
    const benchmarkGuard = this.rejectDuringBenchmark("切换从站状态");
    if (benchmarkGuard) {
      return benchmarkGuard;
    }
    if (!this.snapshot.connected) {
      return { ok: false, message: "总线未启动" };
    }
    const slave = this.snapshot.slaves.find((item) => item.index === index);
    if (!slave) {
      return { ok: false, message: "从站不存在" };
    }
    if (slave.state === target) {
      return { ok: true, message: `从站已处于 ${target}` };
    }

    for (const state of transitionPath(slave.state, target)) {
      await this.delay(130);
      const alStatus = this.stateStatus(state);
      this.patch({
        slaves: this.snapshot.slaves.map((item) =>
          item.index === index
            ? {
                ...item,
                state,
                alStatus,
                alStatusCode: state
              }
            : item
        )
      });
      this.log("info", `SLAVE ${index}`, `状态切换 -> ${state}`);
    }
    const phase = this.aggregatePhase();
    const expected = expectedWorkingCounter(this.snapshot.slaves.length);
    this.patch({
      phase,
      telemetry: {
        ...this.snapshot.telemetry,
        wkc: phase === "op" ? expected : 0,
        expectedWkc: expected
      }
    });
    return { ok: true, message: `从站 ${index} 已切换到 ${target}` };
  }

  async transitionAll(target: SlaveState): Promise<CommandResult> {
    const benchmarkGuard = this.rejectDuringBenchmark("整组状态切换");
    if (benchmarkGuard) {
      return benchmarkGuard;
    }
    if (!this.snapshot.connected) {
      return { ok: false, message: "总线未启动" };
    }
    if (this.snapshot.slaves.length === 0) {
      return { ok: false, message: "尚未扫描到从站" };
    }

    const paths = this.snapshot.slaves.map((slave) =>
      transitionPath(slave.state, target)
    );
    const maxSteps = Math.max(...paths.map((path) => path.length));
    for (let step = 0; step < maxSteps; step += 1) {
      await this.delay(150);
      this.patch({
        slaves: this.snapshot.slaves.map((slave, index) => {
          const state = paths[index][step] ?? slave.state;
          return {
            ...slave,
            state,
            alStatus: this.stateStatus(state),
            alStatusCode: state
          };
        })
      });
      const stage = paths.find((path) => path[step])?.[step];
      if (stage) {
        this.log("info", "MASTER", `广播状态切换 -> ${stage}`);
      }
    }
    const phase = this.aggregatePhase();
    const expected = expectedWorkingCounter(this.snapshot.slaves.length);
    this.patch({
      phase,
      telemetry: {
        ...this.snapshot.telemetry,
        wkc: target === "OP" ? expected : 0,
        expectedWkc: expected
      }
    });
    if (target === "OP") {
      this.log("success", "MASTER", "所有从站已进入 OP，周期交换已启用");
      this.startTicker();
    }
    return { ok: true, message: `所有从站已切换到 ${target}` };
  }

  async sdoRead(request: SdoRequest): Promise<CommandResult<SdoResult>> {
    const guard = this.mailboxGuard<SdoResult>(request.slaveIndex);
    if (guard) {
      return guard;
    }
    try {
      parseEthercatIndex(request.index);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "对象索引无效"
      };
    }
    await this.delay(45);
    const valueHex = objectValue(request.index, request.subIndex);
    const elapsedUs = 310 + Math.round(Math.random() * 80);
    this.log(
      "success",
      "SDO",
      `读取 0x${request.index.replace(/^0x/i, "").padStart(4, "0")}:${formatHex(request.subIndex, 2)} = 0x${valueHex}`
    );
    return {
      ok: true,
      message: "SDO 上传完成",
      data: {
        valueHex,
        valueDecimal: Number.parseInt(valueHex, 16).toString(10),
        elapsedUs
      }
    };
  }

  async sdoWrite(request: SdoRequest): Promise<CommandResult<SdoResult>> {
    const guard = this.mailboxGuard<SdoResult>(request.slaveIndex);
    if (guard) {
      return guard;
    }
    try {
      parseEthercatIndex(request.index);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "对象索引无效"
      };
    }
    const valueHex = (request.valueHex ?? "").replace(/[^0-9a-f]/gi, "");
    if (!valueHex || valueHex.length % 2 !== 0) {
      return { ok: false, message: "写入数据必须是整字节十六进制" };
    }
    await this.delay(55);
    const elapsedUs = 340 + Math.round(Math.random() * 90);
    this.log(
      "success",
      "SDO",
      `写入 ${request.index}:${formatHex(request.subIndex, 2)} <- 0x${valueHex.toUpperCase()}`
    );
    return {
      ok: true,
      message: "SDO 下载成功",
      data: {
        valueHex: valueHex.toUpperCase(),
        valueDecimal: Number.parseInt(valueHex, 16).toString(10),
        elapsedUs
      }
    };
  }

  async writePdo(
    slaveIndex: number,
    index: string,
    subIndex: number,
    value: string
  ): Promise<CommandResult> {
    const benchmarkGuard = this.rejectDuringBenchmark("写 PDO");
    if (benchmarkGuard) {
      return benchmarkGuard;
    }
    if (this.snapshot.phase !== "op") {
      return { ok: false, message: "PDO 写入要求总线处于 OP" };
    }
    const slave = this.snapshot.slaves.find((item) => item.index === slaveIndex);
    if (!slave) {
      return { ok: false, message: "从站不存在" };
    }
    const entry = slave.outputs.find(
      (item) =>
        item.index.toLowerCase() === index.toLowerCase() &&
        item.subIndex === subIndex
    );
    if (!entry) {
      return { ok: false, message: "该 PDO 对象不可写或不存在" };
    }
    this.patch({
      slaves: this.snapshot.slaves.map((item) =>
        item.index === slaveIndex
          ? {
              ...item,
              outputs: item.outputs.map((output) =>
                output === entry ? { ...output, value } : output
              )
            }
          : item
      )
    });
    this.log(
      "info",
      "PDO",
      `从站 ${slaveIndex} · ${entry.name} <- ${value}`
    );
    return { ok: true, message: "PDO 已写入周期映像" };
  }

  async sendMailbox(
    request: MailboxRequest
  ): Promise<CommandResult<MailboxResult>> {
    const guard = this.mailboxGuard<MailboxResult>(request.slaveIndex);
    if (guard) {
      return guard;
    }
    const payload = request.payloadHex.replace(/[^0-9a-f]/gi, "");
    if (!payload || payload.length % 2 !== 0) {
      return { ok: false, message: "邮箱数据必须是整字节十六进制" };
    }
    const slave = this.snapshot.slaves.find(
      (item) => item.index === request.slaveIndex
    );
    if (
      slave &&
      !slave.mailboxProtocols.includes(request.protocol)
    ) {
      return { ok: false, message: `从站未声明 ${request.protocol} 邮箱服务` };
    }
    await this.delay(95);
    const responseHex = `${payload.slice(0, Math.min(payload.length, 12))}0A00`;
    this.log(
      "success",
      "MAILBOX",
      `${request.protocol} · 从站 ${request.slaveIndex} · ${payload.length / 2} bytes`
    );
    return {
      ok: true,
      message: "邮箱响应已接收",
      data: {
        responseHex,
        elapsedUs: 460 + Math.round(Math.random() * 120)
      }
    };
  }

  async startFoe(
    direction: "upload" | "download",
    file: FoeFileInfo,
    password: string
  ): Promise<CommandResult> {
    const benchmarkGuard = this.rejectDuringBenchmark("启动 FoE");
    if (benchmarkGuard) {
      return benchmarkGuard;
    }
    if (!this.snapshot.connected) {
      return { ok: false, message: "总线未启动" };
    }
    const selected = this.snapshot.slaves.find(
      (slave) => slave.index === this.snapshot.selectedSlaveIndex
    );
    if (!selected?.mailboxProtocols.includes("FoE")) {
      return { ok: false, message: "所选从站不支持 FoE" };
    }
    if (this.snapshot.transfer.active) {
      return { ok: false, message: "已有 FoE 任务正在执行" };
    }

    this.stopTransferTimer();
    this.patch({
      transfer: {
        active: true,
        direction,
        fileName: file.name,
        progress: 0,
        progressAvailable: direction === "download",
        bytesCompleted: 0,
        bytesTotal: direction === "download" ? file.size : 0,
        status: "running",
        message:
          direction === "download"
            ? `正在下载固件${password ? "（已加密）" : ""}`
            : "正在上传固件区"
      }
    });
    this.log(
      "info",
      "FoE",
      `${direction === "download" ? "下载" : "上传"} ${file.name} (${file.size} bytes)`
    );

    this.transferTimer = setInterval(() => {
      const next = Math.min(100, this.snapshot.transfer.progress + 4);
      const finished = next >= 100;
      this.patch({
        transfer: {
          ...this.snapshot.transfer,
          active: !finished,
          progress: next,
          bytesCompleted:
            this.snapshot.transfer.bytesTotal > 0
              ? Math.round(
                  (this.snapshot.transfer.bytesTotal * next) / 100
                )
              : 0,
          status: finished ? "success" : "running",
          message: finished
            ? "FoE 模拟传输完成；未执行真实 CRC 校验"
            : "正在传输数据块"
        }
      });
      if (finished) {
        this.stopTransferTimer();
        this.log(
          "success",
          "FoE",
          `${file.name} 模拟传输完成；未执行真实 CRC 校验`
        );
      }
    }, Math.max(15, this.latencyScale * 70));

    return { ok: true, message: "FoE 任务已启动" };
  }

  async cancelFoe(): Promise<CommandResult> {
    if (!this.snapshot.transfer.active) {
      return { ok: false, message: "当前没有 FoE 任务" };
    }
    this.cancelTransferInternal();
    this.log("warning", "FoE", "FoE 任务已取消");
    return { ok: true, message: "FoE 任务已取消" };
  }

  async benchmarkStart(durationSec: number): Promise<CommandResult> {
    const duration = Math.round(durationSec);
    if (!this.snapshot.connected || this.snapshot.phase !== "op") {
      return {
        ok: false,
        message: "实时基准测试要求模拟总线已经进入 OP"
      };
    }
    if (this.snapshot.benchmark.status === "running") {
      return { ok: false, message: "实时基准测试已经在运行" };
    }
    if (duration < 1 || duration > 8 * 60 * 60) {
      return {
        ok: false,
        message: "实时基准测试时长必须为 1 秒至 8 小时"
      };
    }
    if (this.snapshot.transfer.active) {
      return { ok: false, message: "请等待 FoE 任务结束后再启动实时基准测试" };
    }

    this.benchmarkStartedAt = this.now();
    this.benchmarkDurationSec = duration;
    this.benchmarkCompletionLogged = false;
    this.patch({
      benchmark: simulatedBenchmark(
        "running",
        duration,
        0,
        this.snapshot.config.cycleUs,
        this.benchmarkStartedAt
      )
    });
    this.log(
      "info",
      "RT",
      `模拟实时基准测试开始：${this.snapshot.config.cycleUs} µs，持续 ${duration} 秒`
    );
    return { ok: true, message: "模拟实时基准测试已开始" };
  }

  async benchmarkStop(): Promise<CommandResult> {
    if (this.snapshot.benchmark.status !== "running") {
      return { ok: false, message: "当前没有运行中的实时基准测试" };
    }
    const now = this.now();
    this.patch({
      benchmark: simulatedBenchmark(
        "stopped",
        this.benchmarkDurationSec,
        Math.max(0, (now - this.benchmarkStartedAt) / 1000),
        this.snapshot.config.cycleUs,
        this.benchmarkStartedAt,
        now
      )
    });
    this.log("info", "RT", "模拟实时基准测试已停止");
    return { ok: true, message: "实时基准测试已停止" };
  }

  async updateConfig(config: Partial<MasterConfig>): Promise<CommandResult> {
    const benchmarkGuard = this.rejectDuringBenchmark("修改周期配置");
    if (benchmarkGuard) {
      return benchmarkGuard;
    }
    const next = { ...this.snapshot.config, ...config };
    next.cycleUs = Math.max(250, Math.min(10_000, Math.round(next.cycleUs)));
    next.sendTimeoutUs = Math.max(
      next.cycleUs,
      Math.min(100_000, Math.round(next.sendTimeoutUs))
    );
    next.receiveTimeoutUs = Math.max(
      next.cycleUs,
      Math.min(100_000, Math.round(next.receiveTimeoutUs))
    );
    next.dedicatedCore = Math.max(0, Math.min(63, next.dedicatedCore));
    next.retainFrames = Math.max(
      100,
      Math.min(100000, Math.round(next.retainFrames))
    );
    this.patch({
      config: next,
      selectedAdapterId: next.adapterId
    });
    this.log("info", "CONFIG", `周期已设置为 ${next.cycleUs} us`);
    return { ok: true, message: "配置已应用" };
  }

  async clearLogs(): Promise<CommandResult> {
    this.patch({ logs: [] });
    return { ok: true, message: "日志已清空" };
  }

  async loadEni(): Promise<CommandResult<string>> {
    const benchmarkGuard = this.rejectDuringBenchmark<string>("载入 ENI");
    if (benchmarkGuard) {
      return benchmarkGuard;
    }
    await this.delay(180);
    this.patch({
      config: { ...this.snapshot.config, eniPath: "demo-line.eni" }
    });
    this.log(
      "info",
      "ENI",
      "已登记 demo-line.eni；模拟核心继续使用内置过程数据映射"
    );
    return {
      ok: true,
      message: "ENI 配置已登记，模拟映射保持不变",
      data: "demo-line.eni"
    };
  }

  dispose(): void {
    this.stopTicker();
    this.stopTransferTimer();
    this.listeners.clear();
  }

  private startTicker(): void {
    if (!this.autoTick) {
      return;
    }
    this.stopTicker();
    this.cycleTimer = setInterval(() => this.tick(), 50);
  }

  private stopTicker(): void {
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
  }

  private stopTransferTimer(): void {
    if (this.transferTimer) {
      clearInterval(this.transferTimer);
      this.transferTimer = null;
    }
  }

  private cancelTransferInternal(): void {
    this.stopTransferTimer();
    if (this.snapshot.transfer.active) {
      this.patch({
        transfer: {
          ...this.snapshot.transfer,
          active: false,
          status: "error",
          message: "任务已取消"
        }
      });
    }
  }

  private tick(): void {
    if (!this.snapshot.connected) {
      return;
    }
    const intervalCycles = Math.max(
      1,
      Math.round((this.snapshot.config.cycleUs * 50) / 1_000_000)
    );
    const cycles = this.snapshot.counters.cycles + intervalCycles;
    const wave =
      Math.sin(cycles / 53) * 7 +
      Math.cos(cycles / 131) * 4 +
      Math.sin(cycles / 17) * 2;
    const jitterUs = Math.max(1, Math.round(Math.abs(wave) + 5));
    const cycleUs = this.snapshot.config.cycleUs + Math.round(wave);
    const expected = expectedWorkingCounter(this.snapshot.slaves.length);
    const allOp = this.snapshot.slaves.every((slave) => slave.state === "OP");
    const wkc = allOp ? expected : Math.max(0, expected - 1);
    const sample: TelemetryPoint = {
      at: this.now(),
      cycleUs,
      jitterUs,
      wkc,
      expectedWkc: expected,
      lostFrames: this.snapshot.counters.lostFrames,
      dcOffsetNs: Math.round(60 + Math.sin(cycles / 91) * 24)
    };
    const history = limitHistory(
      [...this.snapshot.history, sample],
      90
    );
    const isWorking = this.snapshot.phase === "op";
    const slaves = this.snapshot.slaves.map((slave) => {
      if (!isWorking) {
        return slave;
      }
      return {
        ...slave,
        inputs: slave.inputs.map((entry) => {
          if (entry.name === "Position actual") {
            return {
              ...entry,
              value: String(1_000_000 + Math.round(Math.sin(cycles / 24) * 800))
            };
          }
          if (entry.name === "Position") {
            return {
              ...entry,
              value: String(482_190 + Math.round(Math.sin(cycles / 19) * 60))
            };
          }
          if (entry.name === "Torque actual") {
            return {
              ...entry,
              value: String(34 + Math.round(Math.sin(cycles / 31) * 5))
            };
          }
          return entry;
        })
      };
    });

    const nextBenchmark =
      this.snapshot.benchmark.status === "running"
        ? this.advanceBenchmark(this.now())
        : this.snapshot.benchmark;
    this.patch({
      telemetry: sample,
      history,
      slaves,
      benchmark: nextBenchmark,
      counters: {
        ...this.snapshot.counters,
        cycles,
        uptimeSec: Math.floor((this.now() - this.startedAt) / 1000)
      }
    });
    if (
      this.snapshot.benchmark.status === "completed" &&
      !this.benchmarkCompletionLogged
    ) {
      this.benchmarkCompletionLogged = true;
      this.log(
        "success",
        "RT",
        `模拟实时基准测试完成：${this.snapshot.benchmark.samples} 个样本`
      );
    }
  }

  private aggregatePhase(): Snapshot["phase"] {
    if (this.snapshot.slaves.length === 0) {
      return this.snapshot.connected ? "preop" : "offline";
    }
    const lowestState = this.snapshot.slaves.reduce((lowest, slave) => {
      const rank = ["INIT", "PRE-OP", "SAFE-OP", "OP"].indexOf(slave.state);
      return Math.min(lowest, rank);
    }, 3);
    if (lowestState === 3) {
      return "op";
    }
    if (lowestState === 2) {
      return "safeop";
    }
    return "preop";
  }

  private stateStatus(state: SlaveState): number {
    return {
      INIT: 0x0001,
      "PRE-OP": 0x0002,
      "SAFE-OP": 0x0004,
      OP: 0x0008
    }[state];
  }

  private mailboxGuard<T>(slaveIndex: number): CommandResult<T> | null {
    const benchmarkGuard = this.rejectDuringBenchmark<T>("邮箱操作");
    if (benchmarkGuard) {
      return benchmarkGuard;
    }
    if (!this.snapshot.connected) {
      return { ok: false, message: "总线未启动" };
    }
    if (!this.snapshot.slaves.some((slave) => slave.index === slaveIndex)) {
      return { ok: false, message: "从站不存在" };
    }
    return null;
  }

  private rejectDuringBenchmark<T = unknown>(
    operation: string
  ): CommandResult<T> | null {
    if (this.snapshot.benchmark.status !== "running") {
      return null;
    }
    return {
      ok: false,
      message: `实时基准测试运行期间禁止${operation}，请先停止测试`
    };
  }

  private advanceBenchmark(now: number): RealtimeBenchmark {
    const elapsedSec = Math.max(0, (now - this.benchmarkStartedAt) / 1000);
    const completed = elapsedSec >= this.benchmarkDurationSec;
    return simulatedBenchmark(
      completed ? "completed" : "running",
      this.benchmarkDurationSec,
      elapsedSec,
      this.snapshot.config.cycleUs,
      this.benchmarkStartedAt,
      completed ? now : 0
    );
  }

  private adapterName(adapterId: string): string {
    return (
      this.snapshot.adapters.find((adapter) => adapter.id === adapterId)?.name ??
      adapterId
    );
  }

  private log(level: LogLevel, source: string, message: string): void {
    this.patch({
      logs: [
        this.makeLog(level, source, message, this.now()),
        ...this.snapshot.logs
      ].slice(0, 240)
    });
  }

  private makeLog(
    level: LogLevel,
    source: string,
    message: string,
    at: number
  ): LogEntry {
    this.idCounter += 1;
    return {
      id: `sim-${at}-${this.idCounter}`,
      at,
      level,
      source,
      message
    };
  }

  private patch(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    const delivered = this.getSnapshot();
    this.listeners.forEach((listener) => listener(delivered));
  }

  private async delay(ms: number): Promise<void> {
    if (this.latencyScale <= 0) {
      return;
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(1, ms * this.latencyScale))
    );
  }
}
