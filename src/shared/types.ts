export type MasterPhase =
  | "offline"
  | "connecting"
  | "preop"
  | "safeop"
  | "op"
  | "error";

export type SlaveState = "INIT" | "PRE-OP" | "SAFE-OP" | "OP";

export type LogLevel = "info" | "success" | "warning" | "error";

export type CoreMode = "simulator" | "soem";

export interface EcatAdapter {
  id: string;
  name: string;
  description: string;
  mac: string;
  linkUp: boolean;
  driver: string;
  dedicated: boolean;
}

export interface PdoEntry {
  index: string;
  subIndex: number;
  name: string;
  type: string;
  value: string;
  unit?: string;
  writable: boolean;
}

export interface EcatSlave {
  index: number;
  name: string;
  vendorId: string;
  productCode: string;
  revision: string;
  serial: string;
  state: SlaveState;
  alStatus: number;
  alStatusCode: string;
  wkc: number;
  dcEnabled: boolean;
  mailboxProtocols: string[];
  inputs: PdoEntry[];
  outputs: PdoEntry[];
}

export interface TelemetryPoint {
  at: number;
  cycleUs: number;
  jitterUs: number;
  wkc: number;
  expectedWkc: number;
  lostFrames: number;
  dcOffsetNs: number;
}

export type RealtimeBenchmarkStatus =
  | "idle"
  | "running"
  | "completed"
  | "stopped"
  | "aborted";

export interface RealtimeDistribution {
  meanUs: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
  p999Us: number;
  maxUs: number;
}

export interface RealtimeBenchmark {
  status: RealtimeBenchmarkStatus;
  durationSec: number;
  elapsedSec: number;
  samples: number;
  cycleTime: RealtimeDistribution;
  ioDuration: RealtimeDistribution;
  scheduleJitter: RealtimeDistribution;
  over1050: number;
  over1200: number;
  over2000: number;
  lostFrames: number;
  wkcErrors: number;
  startedAt: number;
  completedAt: number;
  simulated?: boolean;
}

export interface LogEntry {
  id: string;
  at: number;
  level: LogLevel;
  source: string;
  message: string;
}

export interface MasterConfig {
  adapterId: string;
  cycleUs: number;
  sendTimeoutUs: number;
  receiveTimeoutUs: number;
  autoTransitionOp: boolean;
  distributedClock: boolean;
  realtimePriority: boolean;
  dedicatedCore: number;
  eniPath: string;
  logToDisk: boolean;
  retainFrames: number;
}

export interface Snapshot {
  version: string;
  mode: CoreMode;
  phase: MasterPhase;
  connected: boolean;
  scanning: boolean;
  adapters: EcatAdapter[];
  selectedAdapterId: string;
  slaves: EcatSlave[];
  selectedSlaveIndex: number;
  telemetry: TelemetryPoint;
  history: TelemetryPoint[];
  counters: {
    cycles: number;
    lostFrames: number;
    mailboxErrors: number;
    workingCounterErrors: number;
    uptimeSec: number;
  };
  logs: LogEntry[];
  benchmark: RealtimeBenchmark;
  transfer: {
    active: boolean;
    direction: "upload" | "download";
    fileName: string;
    progress: number;
    progressAvailable: boolean;
    bytesCompleted: number;
    bytesTotal: number;
    status: "idle" | "running" | "success" | "error";
    message: string;
  };
  config: MasterConfig;
  capabilities: {
    hardware: boolean;
    eniImport: boolean;
    eoe: boolean;
    foe: boolean;
    cyclicMailbox?: boolean;
    realtimeBenchmark?: boolean;
    native?: boolean;
  };
}

export interface CommandResult<T = unknown> {
  ok: boolean;
  message: string;
  data?: T;
}

export interface SdoRequest {
  slaveIndex: number;
  index: string;
  subIndex: number;
  dataType: string;
  valueHex?: string;
  completeAccess?: boolean;
}

export interface SdoResult {
  valueHex: string;
  valueDecimal: string;
  elapsedUs: number;
}

export interface MailboxRequest {
  slaveIndex: number;
  protocol: "CoE" | "EoE" | "FoE" | "AoE";
  payloadHex: string;
}

export interface MailboxResult {
  responseHex: string;
  elapsedUs: number;
}

export interface FoeFileInfo {
  name: string;
  path: string;
  size: number;
}

export interface EcatBridge {
  getSnapshot(): Promise<Snapshot>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
  listAdapters(): Promise<EcatAdapter[]>;
  selectAdapter(adapterId: string): Promise<CommandResult>;
  connect(adapterId: string): Promise<CommandResult>;
  disconnect(): Promise<CommandResult>;
  scan(): Promise<CommandResult<number>>;
  selectSlave(index: number): Promise<CommandResult>;
  transitionSlave(index: number, target: SlaveState): Promise<CommandResult>;
  transitionAll(target: SlaveState): Promise<CommandResult>;
  sdoRead(request: SdoRequest): Promise<CommandResult<SdoResult>>;
  sdoWrite(request: SdoRequest): Promise<CommandResult<SdoResult>>;
  writePdo(
    slaveIndex: number,
    index: string,
    subIndex: number,
    value: string
  ): Promise<CommandResult>;
  sendMailbox(request: MailboxRequest): Promise<CommandResult<MailboxResult>>;
  startFoe(
    direction: "upload" | "download",
    file: FoeFileInfo,
    password: string
  ): Promise<CommandResult>;
  cancelFoe(): Promise<CommandResult>;
  benchmarkStart(durationSec: number): Promise<CommandResult>;
  benchmarkStop(): Promise<CommandResult>;
  updateConfig(config: Partial<MasterConfig>): Promise<CommandResult>;
  clearLogs(): Promise<CommandResult>;
  pickFirmware(
    direction: "upload" | "download"
  ): Promise<FoeFileInfo | null>;
  loadEni(): Promise<CommandResult<string>>;
}
