import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const binary = process.env.ECAT_CORE_BIN
  ? path.resolve(process.env.ECAT_CORE_BIN)
  : path.join(process.cwd(), "native", "build", "bin", "ecat-core.exe");

if (!existsSync(binary)) {
  throw new Error(`Native core binary not found: ${binary}`);
}

const child = spawn(binary, ["--mode", "sim"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true
});
const pending = new Map();
let latestSnapshot = null;
let nextId = 1;
let stderr = "";

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

const lines = readline.createInterface({
  input: child.stdout,
  crlfDelay: Number.POSITIVE_INFINITY
});

lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    throw new Error(`Invalid JSON from native core: ${line}`);
  }
  if (message.type === "event" && message.event === "snapshot") {
    latestSnapshot = message.data;
    return;
  }
  if (message.type !== "response") {
    return;
  }
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    waiter.resolve(message);
  }
});

function command(name, params = {}) {
  const id = nextId++;
  const payload = JSON.stringify({ id, command: name, params }) + "\n";
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Native command timed out: ${name}\n${stderr}`));
    }, 5000);
    pending.set(id, {
      resolve: (message) => {
        clearTimeout(timeout);
        resolve(message);
      }
    });
    child.stdin.write(payload);
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const hello = await command("hello");
  assert(hello.ok, hello.message);
  assert(hello.data.mode === "simulator", "Unexpected native core mode");

  const selectAdapter = await command("select_adapter", {
    adapterId: "sim:realtek-usb"
  });
  assert(selectAdapter.ok, selectAdapter.message);

  const updateConfig = await command("update_config", {
    config: {
      adapterId: "sim:intel-i219",
      cycleUs: 2000,
      autoTransitionOp: true
    }
  });
  assert(updateConfig.ok, updateConfig.message);

  const loadEni = await command("load_eni", {
    filePath: path.join(process.cwd(), "package.json")
  });
  assert(loadEni.ok, loadEni.message);
  assert(loadEni.data.mappingApplied === false, "ENI mapping support was overstated");

  const clearLogs = await command("clear_logs");
  assert(clearLogs.ok, clearLogs.message);

  const start = await command("start", {
    adapterId: "sim:intel-i219",
    cycleUs: 2000,
    autoTransitionOp: true
  });
  assert(start.ok, start.message);

  const scan = await command("scan");
  assert(scan.ok, scan.message);
  assert(scan.data.count === 4, "Expected four native simulator slaves");

  const snapshot = await command("get_snapshot");
  assert(snapshot.ok, snapshot.message);
  assert(snapshot.data.phase === "op", "Expected OP after auto-transition");
  assert(snapshot.data.slaves.length === 4, "Snapshot slave count mismatch");
  assert(snapshot.data.config.cycleUs === 2000, "Configuration was not applied");
  assert(
    snapshot.data.logs.every(
      (entry) => !Array.isArray(entry) && typeof entry.at === "number"
    ),
    "Native log entries are not JSON objects"
  );
  await delay(160);
  const telemetrySnapshot = await command("get_snapshot");
  assert(telemetrySnapshot.ok, telemetrySnapshot.message);
  assert(
    telemetrySnapshot.data.history.every(
      (point) => !Array.isArray(point) && typeof point.at === "number"
    ),
    "Native telemetry history entries are not JSON objects"
  );

  const selectSlave = await command("select_slave", { slaveIndex: 2 });
  assert(selectSlave.ok, selectSlave.message);

  const benchmarkStart = await command("benchmark_start", { durationSec: 1 });
  assert(benchmarkStart.ok, benchmarkStart.message);
  const benchmarkSnapshot = await command("get_snapshot");
  assert(benchmarkSnapshot.ok, benchmarkSnapshot.message);
  assert(
    benchmarkSnapshot.data.benchmark.status === "running",
    "Benchmark status was not reported as running"
  );
  assert(
    typeof benchmarkSnapshot.data.benchmark.ioDuration.p99Us === "number",
    "Benchmark I/O duration summary is missing"
  );
  const blockedSdo = await command("sdo_read", {
    slaveIndex: 2,
    index: "6041",
    subIndex: "00",
    completeAccess: false
  });
  assert(
    !blockedSdo.ok,
    "Native simulator did not lock SDO operations during the benchmark"
  );
  const benchmarkStop = await command("benchmark_stop");
  assert(benchmarkStop.ok, benchmarkStop.message);
  const stoppedBenchmarkSnapshot = await command("get_snapshot");
  assert(
    stoppedBenchmarkSnapshot.data.benchmark.status === "stopped",
    "Benchmark did not stop"
  );

  const sdo = await command("sdo_read", {
    slaveIndex: 2,
    index: "6041",
    subIndex: "00",
    completeAccess: false
  });
  assert(sdo.ok, sdo.message);
  assert(sdo.data.valueHex === "0237", "Unexpected SDO response");

  const mailbox = await command("mailbox", {
    slaveIndex: 1,
    protocol: "CoE",
    payloadHex: "4000416000000000"
  });
  assert(mailbox.ok, mailbox.message);
  assert(mailbox.data.responseHex.endsWith("0A00"), "Unexpected mailbox response");

  const safeOp = await command("transition_all", { target: "SAFE-OP" });
  assert(safeOp.ok, safeOp.message);
  const safeSnapshot = await command("get_snapshot");
  assert(safeSnapshot.data.phase === "safeop", "Expected SAFE-OP");

  const stop = await command("stop");
  assert(stop.ok, stop.message);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        binary,
        commands: [
          "hello",
          "select_adapter",
          "update_config",
          "load_eni",
          "clear_logs",
          "start",
          "scan",
          "get_snapshot",
          "select_slave",
          "benchmark_start",
          "benchmark_stop",
          "sdo_read",
          "mailbox",
          "transition_all",
          "stop"
        ],
        observed: {
          mode: hello.data.mode,
          slaves: snapshot.data.slaves.length,
          cycleUs: snapshot.data.config.cycleUs,
          phase: safeSnapshot.data.phase,
          benchmark: stoppedBenchmarkSnapshot.data.benchmark.status,
          latestEventAvailable: latestSnapshot !== null
        }
      },
      null,
      2
    )
  );
} finally {
  child.stdin.end();
  child.kill();
}
