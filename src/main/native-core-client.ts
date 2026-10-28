import {
  spawn,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import readline from "node:readline";
import type {
  CommandResult,
  EcatAdapter,
  FoeFileInfo,
  MailboxRequest,
  MailboxResult,
  MasterConfig,
  SdoRequest,
  SdoResult,
  SlaveState,
  Snapshot
} from "../shared/types";

type CoreMode = "sim" | "soem";

interface WireResponse<T = unknown> {
  type: "response";
  id: string | number | null;
  ok: boolean;
  message: string;
  data?: T;
}

interface WireEvent<T = unknown> {
  type: "event";
  event: string;
  data: T;
}

interface PendingRequest {
  command: string;
  resolve: (message: WireResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface NativeHello {
  mode: "simulator" | "soem";
  capabilities: Snapshot["capabilities"];
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const FOE_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

export class NativeCoreClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<(snapshot: Snapshot) => void>();
  private latestSnapshot: Snapshot | null = null;
  private stderrTail = "";
  private nextId = 1;
  private closing = false;

  constructor(
    private readonly binaryPath: string,
    readonly mode: CoreMode,
    private readonly onFatalError?: (error: Error) => void
  ) {}

  async start(): Promise<NativeHello> {
    if (this.child) {
      throw new Error("Native core client is already started");
    }

    const child = spawn(this.binaryPath, ["--mode", this.mode], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-8000);
    });

    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY
    });
    lines.on("line", (line) => this.handleLine(line));
    child.once("error", (error) => this.failAll(error));
    child.once("exit", (code, signal) => {
      const detail = this.stderrTail.trim();
      const suffix = detail ? `: ${detail}` : "";
      const error = new Error(
        `Native EtherCAT core exited (code=${code ?? "null"}, signal=${signal ?? "none"})${suffix}`
      );
      this.failAll(error);
      if (!this.closing) {
        this.onFatalError?.(error);
      }
      this.child = null;
      lines.close();
    });

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.off("error", onStartupError);
        resolve();
      };
      const onStartupError = (error: Error) => {
        child.off("spawn", onSpawn);
        reject(error);
      };
      child.once("spawn", onSpawn);
      child.once("error", onStartupError);
    });

    const hello = await this.data<NativeHello>("hello");
    await this.getSnapshot();
    return hello;
  }

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener);
    if (this.latestSnapshot) {
      listener(this.latestSnapshot);
    }
    return () => this.listeners.delete(listener);
  }

  async getSnapshot(): Promise<Snapshot> {
    const snapshot = await this.data<Snapshot>("get_snapshot");
    this.publishSnapshot(snapshot);
    return snapshot;
  }

  async listAdapters(): Promise<EcatAdapter[]> {
    return this.data<EcatAdapter[]>("list_adapters");
  }

  selectAdapter(adapterId: string): Promise<CommandResult> {
    return this.command("select_adapter", { adapterId });
  }

  async connect(adapterId: string): Promise<CommandResult> {
    const snapshot = this.latestSnapshot ?? (await this.getSnapshot());
    return this.command("start", {
      adapterId,
      cycleUs: snapshot.config.cycleUs,
      autoTransitionOp: snapshot.config.autoTransitionOp
    });
  }

  disconnect(): Promise<CommandResult> {
    return this.command("stop");
  }

  scan(): Promise<CommandResult<number>> {
    return this.command("scan");
  }

  selectSlave(index: number): Promise<CommandResult> {
    return this.command("select_slave", { slaveIndex: index });
  }

  transitionSlave(index: number, target: SlaveState): Promise<CommandResult> {
    return this.command("transition", { slaveIndex: index, target });
  }

  transitionAll(target: SlaveState): Promise<CommandResult> {
    return this.command("transition_all", { target });
  }

  sdoRead(request: SdoRequest): Promise<CommandResult<SdoResult>> {
    return this.command("sdo_read", {
      slaveIndex: request.slaveIndex,
      index: request.index,
      subIndex: request.subIndex.toString(16),
      completeAccess: request.completeAccess === true
    });
  }

  sdoWrite(request: SdoRequest): Promise<CommandResult<SdoResult>> {
    return this.command("sdo_write", {
      slaveIndex: request.slaveIndex,
      index: request.index,
      subIndex: request.subIndex.toString(16),
      valueHex: request.valueHex ?? "",
      completeAccess: request.completeAccess === true
    });
  }

  writePdo(
    slaveIndex: number,
    index: string,
    subIndex: number,
    value: string
  ): Promise<CommandResult> {
    return this.command("write_pdo", {
      slaveIndex,
      index,
      subIndex: subIndex.toString(16),
      value
    });
  }

  sendMailbox(request: MailboxRequest): Promise<CommandResult<MailboxResult>> {
    return this.command("mailbox", {
      slaveIndex: request.slaveIndex,
      protocol: request.protocol,
      payloadHex: request.payloadHex
    });
  }

  startFoe(
    direction: "upload" | "download",
    file: FoeFileInfo,
    password: string
  ): Promise<CommandResult> {
    return this.command(
      "foe_start",
      {
        direction,
        filePath: file.path,
        fileName: file.name,
        password: parsePassword(password)
      },
      FOE_REQUEST_TIMEOUT_MS
    );
  }

  cancelFoe(): Promise<CommandResult> {
    return this.command("foe_cancel");
  }

  benchmarkStart(durationSec: number): Promise<CommandResult> {
    return this.command("benchmark_start", { durationSec });
  }

  benchmarkStop(): Promise<CommandResult> {
    return this.command("benchmark_stop");
  }

  updateConfig(config: Partial<MasterConfig>): Promise<CommandResult> {
    return this.command("update_config", { config });
  }

  clearLogs(): Promise<CommandResult> {
    return this.command("clear_logs");
  }

  async loadEni(filePath: string): Promise<CommandResult<string>> {
    return this.command("load_eni", { filePath });
  }

  async dispose(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    const child = this.child;
    if (!child) {
      return;
    }
    this.failAll(new Error("Native core client closed"));
    child.stdin.end();
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 750))
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    this.child = null;
  }

  private async command<T = unknown>(
    name: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<CommandResult<T>> {
    const child = this.child;
    if (!child || child.stdin.destroyed || this.closing) {
      throw new Error("Native core is not running");
    }

    const id = this.nextId++;
    const response = await new Promise<WireResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Native command timed out: ${name} (${timeoutMs} ms)` +
              (this.stderrTail ? `\n${this.stderrTail.trim()}` : "")
          )
        );
      }, timeoutMs);
      this.pending.set(id, { command: name, resolve, reject, timer });
      const payload = `${JSON.stringify({
        id,
        command: name,
        params
      })}\n`;
      child.stdin.write(payload, (error) => {
        if (!error) {
          return;
        }
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(id);
          pending.reject(error);
        }
      });
    });

    return {
      ok: response.ok,
      message: response.message,
      data: response.data as T | undefined
    };
  }

  private async data<T>(
    name: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<T> {
    const result = await this.command<T>(name, params, timeoutMs);
    if (!result.ok) {
      throw new Error(result.message || `Native command failed: ${name}`);
    }
    if (result.data === undefined) {
      throw new Error(`Native command returned no data: ${name}`);
    }
    return result.data;
  }

  private handleLine(line: string): void {
    let message: WireResponse | WireEvent;
    try {
      message = JSON.parse(line) as WireResponse | WireEvent;
    } catch (error) {
      this.onFatalError?.(
        new Error(
          `Invalid JSON from native core: ${line} (${error instanceof Error ? error.message : String(error)})`
        )
      );
      return;
    }

    if (message.type === "event") {
      if (message.event === "snapshot") {
        this.publishSnapshot(message.data as Snapshot);
      }
      return;
    }
    if (message.type !== "response" || typeof message.id !== "number") {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    pending.resolve(message);
  }

  private publishSnapshot(snapshot: Snapshot): void {
    this.latestSnapshot = snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error(`${pending.command} failed: ${error.message}`, {
          cause: error
        })
      );
    }
    this.pending.clear();
  }
}

function parsePassword(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }
  const parsed = /^0x/i.test(normalized)
    ? Number.parseInt(normalized.slice(2), 16)
    : Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(0xffff_ffff, parsed)) : 0;
}
