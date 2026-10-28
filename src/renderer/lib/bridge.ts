import { CoreSimulator } from "../../shared/simulator";
import type { EcatBridge, FoeFileInfo, Snapshot } from "../../shared/types";

class BrowserSimulatorBridge implements EcatBridge {
  private readonly simulated = new CoreSimulator();

  getSnapshot() {
    return Promise.resolve(this.simulated.getSnapshot());
  }

  subscribe(listener: (snapshot: Snapshot) => void) {
    return this.simulated.subscribe(listener);
  }

  listAdapters() {
    return Promise.resolve(this.simulated.listAdapters());
  }

  selectAdapter(adapterId: string) {
    return this.simulated.selectAdapter(adapterId);
  }

  connect(adapterId: string) {
    return this.simulated.connect(adapterId);
  }

  disconnect() {
    return this.simulated.disconnect();
  }

  scan() {
    return this.simulated.scan();
  }

  selectSlave(index: number) {
    return this.simulated.selectSlave(index);
  }

  transitionSlave(
    index: number,
    target: Parameters<CoreSimulator["transitionSlave"]>[1]
  ) {
    return this.simulated.transitionSlave(index, target);
  }

  transitionAll(target: Parameters<CoreSimulator["transitionAll"]>[0]) {
    return this.simulated.transitionAll(target);
  }

  sdoRead(request: Parameters<CoreSimulator["sdoRead"]>[0]) {
    return this.simulated.sdoRead(request);
  }

  sdoWrite(request: Parameters<CoreSimulator["sdoWrite"]>[0]) {
    return this.simulated.sdoWrite(request);
  }

  writePdo(
    slaveIndex: number,
    index: string,
    subIndex: number,
    value: string
  ) {
    return this.simulated.writePdo(slaveIndex, index, subIndex, value);
  }

  sendMailbox(request: Parameters<CoreSimulator["sendMailbox"]>[0]) {
    return this.simulated.sendMailbox(request);
  }

  startFoe(
    direction: "upload" | "download",
    file: FoeFileInfo,
    password: string
  ) {
    return this.simulated.startFoe(direction, file, password);
  }

  cancelFoe() {
    return this.simulated.cancelFoe();
  }

  benchmarkStart(durationSec: number) {
    return this.simulated.benchmarkStart(durationSec);
  }

  benchmarkStop() {
    return this.simulated.benchmarkStop();
  }

  updateConfig(config: Parameters<CoreSimulator["updateConfig"]>[0]) {
    return this.simulated.updateConfig(config);
  }

  clearLogs() {
    return this.simulated.clearLogs();
  }

  pickFirmware() {
    return Promise.resolve(null);
  }

  loadEni() {
    return this.simulated.loadEni();
  }
}

export const ecatBridge: EcatBridge =
  window.ecatBridge ?? new BrowserSimulatorBridge();

export const isDesktop =
  typeof window !== "undefined" && Boolean(window.ecatBridge);
