import { existsSync } from "node:fs";
import { CoreSimulator } from "../shared/simulator";
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
import { NativeCoreClient } from "./native-core-client";

type CoreMode = "sim" | "soem";

export interface CoreRuntime {
  readonly mode: string;
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
  loadEni(filePath: string): Promise<CommandResult<string>>;
  dispose(): Promise<void>;
}

class SimulatorCoreRuntime implements CoreRuntime {
  readonly mode = "typescript-simulator";
  private readonly simulator = new CoreSimulator();

  async getSnapshot(): Promise<Snapshot> {
    return this.simulator.getSnapshot();
  }

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    return this.simulator.subscribe(listener);
  }

  async listAdapters(): Promise<EcatAdapter[]> {
    return this.simulator.listAdapters();
  }

  selectAdapter(adapterId: string) {
    return this.simulator.selectAdapter(adapterId);
  }

  connect(adapterId: string) {
    return this.simulator.connect(adapterId);
  }

  disconnect() {
    return this.simulator.disconnect();
  }

  scan() {
    return this.simulator.scan();
  }

  selectSlave(index: number) {
    return this.simulator.selectSlave(index);
  }

  transitionSlave(index: number, target: SlaveState) {
    return this.simulator.transitionSlave(index, target);
  }

  transitionAll(target: SlaveState) {
    return this.simulator.transitionAll(target);
  }

  sdoRead(request: SdoRequest) {
    return this.simulator.sdoRead(request);
  }

  sdoWrite(request: SdoRequest) {
    return this.simulator.sdoWrite(request);
  }

  writePdo(
    slaveIndex: number,
    index: string,
    subIndex: number,
    value: string
  ) {
    return this.simulator.writePdo(slaveIndex, index, subIndex, value);
  }

  sendMailbox(request: MailboxRequest) {
    return this.simulator.sendMailbox(request);
  }

  startFoe(
    direction: "upload" | "download",
    file: FoeFileInfo,
    password: string
  ) {
    return this.simulator.startFoe(direction, file, password);
  }

  cancelFoe() {
    return this.simulator.cancelFoe();
  }

  benchmarkStart(durationSec: number) {
    return this.simulator.benchmarkStart(durationSec);
  }

  benchmarkStop() {
    return this.simulator.benchmarkStop();
  }

  updateConfig(config: Partial<MasterConfig>) {
    return this.simulator.updateConfig(config);
  }

  clearLogs() {
    return this.simulator.clearLogs();
  }

  async loadEni(filePath: string): Promise<CommandResult<string>> {
    const updated = await this.simulator.updateConfig({ eniPath: filePath });
    return {
      ok: updated.ok,
      message: updated.ok
        ? "ENI file registered; built-in simulator mapping remains active"
        : updated.message,
      data: updated.ok ? filePath : undefined
    };
  }

  async dispose(): Promise<void> {
    this.simulator.dispose();
  }
}

export async function createCoreRuntime(
  binaryPath: string
): Promise<CoreRuntime> {
  const requestedMode = process.env.ECAT_CORE_MODE?.trim().toLowerCase();
  const modes: CoreMode[] =
    requestedMode === "sim" || requestedMode === "simulator"
      ? ["sim"]
      : requestedMode === "soem"
        ? ["soem"]
        : ["soem", "sim"];

  if (!existsSync(binaryPath)) {
    console.warn(
      `[ECAT] Native core not found at ${binaryPath}; using TypeScript simulator`
    );
    return new SimulatorCoreRuntime();
  }

  const failures: string[] = [];
  for (const mode of modes) {
    const client = new NativeCoreClient(binaryPath, mode, (error) => {
      console.error(`[ECAT] Native core failure: ${error.message}`);
    });
    try {
      const hello = await client.start();
      console.info(
        `[ECAT] Native core ${hello.mode} started from ${binaryPath}`
      );
      return client;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${mode}: ${message}`);
      await client.dispose();
    }
  }

  console.warn(
    `[ECAT] Native core unavailable; using TypeScript simulator.\n${failures.join("\n")}`
  );
  return new SimulatorCoreRuntime();
}
