import { contextBridge, ipcRenderer } from "electron";
import type {
  EcatBridge,
  FoeFileInfo,
  MailboxRequest,
  MasterConfig,
  SdoRequest,
  SlaveState,
  Snapshot
} from "../shared/types";

const bridge: EcatBridge = {
  getSnapshot: () => ipcRenderer.invoke("ecat:getSnapshot"),
  subscribe: (listener: (snapshot: Snapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) => {
      listener(snapshot);
    };
    ipcRenderer.on("ecat:snapshot", handler);
    return () => ipcRenderer.removeListener("ecat:snapshot", handler);
  },
  listAdapters: () => ipcRenderer.invoke("ecat:listAdapters"),
  selectAdapter: (adapterId: string) =>
    ipcRenderer.invoke("ecat:selectAdapter", adapterId),
  connect: (adapterId: string) => ipcRenderer.invoke("ecat:connect", adapterId),
  disconnect: () => ipcRenderer.invoke("ecat:disconnect"),
  scan: () => ipcRenderer.invoke("ecat:scan"),
  selectSlave: (index: number) => ipcRenderer.invoke("ecat:selectSlave", index),
  transitionSlave: (index: number, target: SlaveState) =>
    ipcRenderer.invoke("ecat:transitionSlave", index, target),
  transitionAll: (target: SlaveState) =>
    ipcRenderer.invoke("ecat:transitionAll", target),
  sdoRead: (request: SdoRequest) => ipcRenderer.invoke("ecat:sdoRead", request),
  sdoWrite: (request: SdoRequest) => ipcRenderer.invoke("ecat:sdoWrite", request),
  writePdo: (
    slaveIndex: number,
    index: string,
    subIndex: number,
    value: string
  ) => ipcRenderer.invoke("ecat:writePdo", slaveIndex, index, subIndex, value),
  sendMailbox: (request: MailboxRequest) =>
    ipcRenderer.invoke("ecat:sendMailbox", request),
  startFoe: (
    direction: "upload" | "download",
    file: FoeFileInfo,
    password: string
  ) => ipcRenderer.invoke("ecat:startFoe", direction, file, password),
  cancelFoe: () => ipcRenderer.invoke("ecat:cancelFoe"),
  benchmarkStart: (durationSec: number) =>
    ipcRenderer.invoke("ecat:benchmarkStart", durationSec),
  benchmarkStop: () => ipcRenderer.invoke("ecat:benchmarkStop"),
  updateConfig: (config: Partial<MasterConfig>) =>
    ipcRenderer.invoke("ecat:updateConfig", config),
  clearLogs: () => ipcRenderer.invoke("ecat:clearLogs"),
  pickFirmware: (direction: "upload" | "download") =>
    ipcRenderer.invoke("ecat:pickFirmware", direction),
  loadEni: () => ipcRenderer.invoke("ecat:loadEni")
};

contextBridge.exposeInMainWorld("ecatBridge", bridge);
