import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import electronPath from "electron";
import { _electron as electron } from "playwright-core";

const artifacts = path.join(process.cwd(), "artifacts");
await mkdir(artifacts, { recursive: true });
const sessionLog = path.join(artifacts, "electron-session.jsonl");
await rm(sessionLog, { force: true });

const app = await electron.launch({
  executablePath: electronPath,
  args: ["."],
  env: {
    ...process.env,
    NODE_ENV: "production",
    ECAT_CORE_MODE: "sim",
    ECAT_SESSION_LOG_PATH: sessionLog
  }
});

try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.locator(".overview-grid").waitFor({ timeout: 15000 });
  const bridgeAvailable = await page.evaluate(
    () => typeof window.ecatBridge?.getSnapshot === "function"
  );
  if (!bridgeAvailable) {
    throw new Error("Electron preload bridge is unavailable");
  }

  const runtime = await page.evaluate(async () => {
    const bridge = window.ecatBridge;
    if (!bridge) {
      throw new Error("Bridge disappeared");
    }
    const initial = await bridge.getSnapshot();
    const adapters = await bridge.listAdapters();
    if (!initial.capabilities.native) {
      throw new Error("Electron is not using the native core process");
    }
    const selected = await bridge.selectAdapter(adapters[0].id);
    const configured = await bridge.updateConfig({
      adapterId: adapters[0].id,
      cycleUs: 1000,
      autoTransitionOp: true,
      logToDisk: true
    });
    const connected = await bridge.connect(adapters[0].id);
    const scanned = await bridge.scan();
    const afterScan = await bridge.getSnapshot();
    const selectedSlave = await bridge.selectSlave(
      afterScan.slaves[1]?.index ?? 1
    );
    const benchmarkStarted = await bridge.benchmarkStart(1);
    const benchmarkSnapshot = await bridge.getSnapshot();
    const benchmarkStopped = await bridge.benchmarkStop();
    const sdo = await bridge.sdoRead({
      slaveIndex: afterScan.slaves[1]?.index ?? 1,
      index: "6041",
      subIndex: 0,
      dataType: "UINT16"
    });
    const cleared = await bridge.clearLogs();
    const stopped = await bridge.disconnect();
    return {
      initialMode: initial.mode,
      native: initial.capabilities.native === true,
      adapters: adapters.length,
      commands: {
        selected: selected.ok,
        configured: configured.ok,
        connected: connected.ok,
        scanned: scanned.ok,
        selectedSlave: selectedSlave.ok,
        benchmarkStarted: benchmarkStarted.ok,
        benchmarkStopped: benchmarkStopped.ok,
        sdo: sdo.ok,
        cleared: cleared.ok,
        stopped: stopped.ok
      },
      slaves: afterScan.slaves.length,
      sdoValue: sdo.data?.valueHex,
      benchmarkStatus: benchmarkSnapshot.benchmark.status
    };
  });

  const failedCommands = Object.entries(runtime.commands)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (failedCommands.length > 0) {
    throw new Error(`IPC commands failed: ${failedCommands.join(", ")}`);
  }
  if (runtime.initialMode !== "simulator" || runtime.adapters < 1) {
    throw new Error(`Unexpected native runtime: ${JSON.stringify(runtime)}`);
  }

  let sessionLogContent = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      sessionLogContent = await readFile(sessionLog, "utf8");
      if (sessionLogContent.trim()) {
        break;
      }
    } catch {
      // The main process may still be flushing its first log batch.
    }
    await delay(100);
  }
  const entries = sessionLogContent
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (entries.length === 0 || entries.some((entry) => !entry.id || !entry.at)) {
    throw new Error("Electron session log was not written as valid JSONL");
  }

  await page.screenshot({
    path: path.join(artifacts, "electron-overview.png"),
    fullPage: false
  });
  await page.getByRole("button", { name: "工作区设置", exact: true }).click();
  await page.locator(".settings-layout").waitFor();

  if (errors.length > 0) {
    throw new Error(`Electron console errors:\n${errors.join("\n")}`);
  }

  console.log(
    JSON.stringify(
      {
        status: "passed",
        electronPath,
        bridgeAvailable,
        runtime,
        sessionLog,
        screenshot: "artifacts/electron-overview.png"
      },
      null,
      2
    )
  );
} finally {
  await app.close();
}
