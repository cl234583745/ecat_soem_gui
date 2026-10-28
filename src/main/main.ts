import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCoreRuntime, type CoreRuntime } from "./core-runtime";
import type {
  FoeFileInfo,
  MailboxRequest,
  MasterConfig,
  SdoRequest,
  SlaveState,
  Snapshot
} from "../shared/types";

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;
let core: CoreRuntime | null = null;
let unsubscribeCore: (() => void) | null = null;
let configPath = "";
let sessionLogPath = "";
let sessionLogWrite = Promise.resolve();
const queuedLogIds = new Set<string>();

function broadcastSnapshot(snapshot: Snapshot) {
  persistSessionLogs(snapshot);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("ecat:snapshot", snapshot);
}

function persistSessionLogs(snapshot: Snapshot) {
  if (!sessionLogPath || !snapshot.config.logToDisk) {
    return;
  }
  const currentLogIds = new Set(snapshot.logs.map((entry) => entry.id));
  for (const id of queuedLogIds) {
    if (!currentLogIds.has(id)) {
      queuedLogIds.delete(id);
    }
  }
  const entries = snapshot.logs
    .filter((entry) => !queuedLogIds.has(entry.id))
    .reverse();
  if (entries.length === 0) {
    return;
  }
  entries.forEach((entry) => queuedLogIds.add(entry.id));
  const content = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  sessionLogWrite = sessionLogWrite
    .then(async () => {
      await mkdir(path.dirname(sessionLogPath), { recursive: true });
      await appendFile(sessionLogPath, content, "utf8");
    })
    .catch((error) => {
      entries.forEach((entry) => queuedLogIds.delete(entry.id));
      console.error("[ECAT] Could not append session log", error);
    });
}

async function persistConfig(config: MasterConfig) {
  if (!configPath) {
    return;
  }
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

async function readPersistedConfig(): Promise<Partial<MasterConfig> | null> {
  if (!configPath) {
    return null;
  }
  try {
    const content = await readFile(configPath, "utf8");
    return JSON.parse(content) as Partial<MasterConfig>;
  } catch {
    return null;
  }
}

function resolveNativeCoreBinary() {
  const override = process.env.ECAT_CORE_BIN?.trim();
  if (override) {
    return path.resolve(override);
  }
  const fileName = process.platform === "win32" ? "ecat-core.exe" : "ecat-core";
  return app.isPackaged
    ? path.join(process.resourcesPath, "native", fileName)
    : path.join(app.getAppPath(), "native", "build", "bin", fileName);
}

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "build", "icon.png")
    : path.join(__dirname, "../../build/icon.png");
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: "#eef1f3",
    title: "ECAT Bench",
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = devServerUrl
      ? url.startsWith(devServerUrl)
      : url.startsWith("file:");
    if (!allowed) {
      event.preventDefault();
    }
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

function registerIpc() {
  ipcMain.handle("ecat:getSnapshot", () => core?.getSnapshot());
  ipcMain.handle("ecat:listAdapters", () => core?.listAdapters() ?? []);
  ipcMain.handle("ecat:selectAdapter", (_event, adapterId: string) =>
    core?.selectAdapter(adapterId)
  );
  ipcMain.handle("ecat:connect", (_event, adapterId: string) =>
    core?.connect(adapterId)
  );
  ipcMain.handle("ecat:disconnect", () => core?.disconnect());
  ipcMain.handle("ecat:scan", () => core?.scan());
  ipcMain.handle("ecat:selectSlave", (_event, index: number) =>
    core?.selectSlave(index)
  );
  ipcMain.handle(
    "ecat:transitionSlave",
    (_event, index: number, target: SlaveState) =>
      core?.transitionSlave(index, target)
  );
  ipcMain.handle("ecat:transitionAll", (_event, target: SlaveState) =>
    core?.transitionAll(target)
  );
  ipcMain.handle("ecat:sdoRead", (_event, request: SdoRequest) =>
    core?.sdoRead(request)
  );
  ipcMain.handle("ecat:sdoWrite", (_event, request: SdoRequest) =>
    core?.sdoWrite(request)
  );
  ipcMain.handle(
    "ecat:writePdo",
    (
      _event,
      slaveIndex: number,
      index: string,
      subIndex: number,
      value: string
    ) => core?.writePdo(slaveIndex, index, subIndex, value)
  );
  ipcMain.handle("ecat:sendMailbox", (_event, request: MailboxRequest) =>
    core?.sendMailbox(request)
  );
  ipcMain.handle(
    "ecat:startFoe",
    (
      _event,
      direction: "upload" | "download",
      file: FoeFileInfo,
      password: string
    ) => core?.startFoe(direction, file, password)
  );
  ipcMain.handle("ecat:cancelFoe", () => core?.cancelFoe());
  ipcMain.handle("ecat:benchmarkStart", (_event, durationSec: number) =>
    core?.benchmarkStart(durationSec)
  );
  ipcMain.handle("ecat:benchmarkStop", () => core?.benchmarkStop());
  ipcMain.handle("ecat:updateConfig", async (_event, config: Partial<MasterConfig>) => {
    const result = await core?.updateConfig(config);
    const snapshot = await core?.getSnapshot();
    if (snapshot) {
      await persistConfig(snapshot.config);
    }
    return result;
  });
  ipcMain.handle("ecat:clearLogs", () => core?.clearLogs());
  ipcMain.handle("ecat:pickFirmware", async (
    _event,
    direction: "upload" | "download"
  ): Promise<FoeFileInfo | null> => {
    if (direction === "upload") {
      const target = await dialog.showSaveDialog(mainWindow!, {
        title: "选择 FoE 上传保存位置",
        defaultPath: "firmware.bin",
        filters: [
          { name: "固件文件", extensions: ["bin", "efw", "img", "hex"] },
          { name: "所有文件", extensions: ["*"] }
        ]
      });
      if (target.canceled || !target.filePath) {
        return null;
      }
      return {
        name: path.basename(target.filePath),
        path: target.filePath,
        size: 0
      };
    }
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "选择 FoE 固件",
      properties: ["openFile"],
      filters: [
        { name: "固件文件", extensions: ["bin", "efw", "img", "hex"] },
        { name: "所有文件", extensions: ["*"] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const selected = result.filePaths[0];
    const file = await readFile(selected);
    return {
      name: path.basename(selected),
      path: selected,
      size: file.byteLength
    };
  });
  ipcMain.handle("ecat:loadEni", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "导入 ENI 配置",
      properties: ["openFile"],
      filters: [{ name: "EtherCAT Network Information", extensions: ["xml", "eni"] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, message: "已取消导入" };
    }
    const loaded = await core?.loadEni(result.filePaths[0]);
    if (loaded) {
      const snapshot = await core?.getSnapshot();
      if (!snapshot) {
        return loaded;
      }
      await persistConfig(snapshot.config);
      return {
        ...loaded,
        message: loaded.ok
          ? `已登记 ${path.basename(result.filePaths[0])}；PDO 仍由 SOEM 自动映射`
          : loaded.message,
        data: result.filePaths[0]
      };
    }
    return loaded;
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId("io.ecatbench.desktop");
  configPath = path.join(app.getPath("userData"), "master-config.json");
  sessionLogPath = process.env.ECAT_SESSION_LOG_PATH?.trim()
    ? path.resolve(process.env.ECAT_SESSION_LOG_PATH)
    : path.join(app.getPath("userData"), "ecat-bench-session.jsonl");
  core = await createCoreRuntime(resolveNativeCoreBinary());
  const persisted = await readPersistedConfig();
  if (persisted) {
    await core.updateConfig(persisted);
  }
  unsubscribeCore = core.subscribe(broadcastSnapshot);
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  unsubscribeCore?.();
  unsubscribeCore = null;
  void core?.dispose();
  core = null;
});
