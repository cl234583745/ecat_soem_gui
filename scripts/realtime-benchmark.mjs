import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { assessBenchmark } from "./benchmark-assessment.mjs";

const root = process.cwd();
const artifacts = path.join(root, "artifacts");
const reportPath = path.resolve(
  process.env.ECAT_BENCHMARK_REPORT ??
    path.join(artifacts, "1ms-benchmark-report.json")
);
const binary = process.env.ECAT_CORE_BIN
  ? path.resolve(process.env.ECAT_CORE_BIN)
  : path.join(root, "native", "build", "bin", "ecat-core.exe");
const cycleUs = Number.parseInt(process.env.ECAT_CYCLE_US ?? "1000", 10);
const durationSec = Number.parseInt(
  readOption("duration") ??
    process.env.ECAT_BENCHMARK_DURATION_SEC ??
    "60",
  10
);
const adapterRef = process.env.ECAT_SOEM_ADAPTER?.trim() ?? "";
const allowNonOneMillisecond = process.env.ECAT_ALLOW_NON_1MS === "1";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage:
  $env:ECAT_SOEM_ADAPTER="Realtek PCIe GbE Family Controller"
  npm run benchmark:1ms

Options:
  --duration <seconds>   Test duration, default 60, maximum 28800

Environment:
  ECAT_SOEM_ADAPTER         Required NPF adapter id or unique name
  ECAT_CYCLE_US             Must be 1000 unless ECAT_ALLOW_NON_1MS=1
  ECAT_BENCHMARK_REPORT     Output path, default artifacts/1ms-benchmark-report.json
  ECAT_CORE_BIN             Native core path override`);
  process.exit(0);
}

const startedAt = new Date().toISOString();
let child = null;
let lines = null;
let pending = new Map();
let nextId = 1;
let stderr = "";
let busStarted = false;
let benchmarkStarted = false;
let latestSnapshot = null;
let report = null;

function readOption(name) {
  const prefix = `--${name}=`;
  const direct = process.argv.find((argument) => argument.startsWith(prefix));
  if (direct) {
    return direct.slice(prefix.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function command(name, params = {}, timeoutMs = 30_000) {
  if (!child) {
    return Promise.reject(new Error("Native core is not running"));
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${name} timed out after ${timeoutMs} ms\n${stderr}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (message) => {
        clearTimeout(timer);
        resolve(message);
      }
    });
    child.stdin.write(`${JSON.stringify({ id, command: name, params })}\n`);
  });
}

async function requiredCommand(name, params = {}, timeoutMs = 30_000) {
  const response = await command(name, params, timeoutMs);
  if (!response.ok) {
    throw new Error(`${name} failed: ${response.message}`);
  }
  return response;
}

function validateInputs() {
  assert(adapterRef, "ECAT_SOEM_ADAPTER is required");
  assert(
    Number.isInteger(durationSec) && durationSec >= 10 && durationSec <= 28_800,
    "Benchmark duration must be an integer from 10 to 28800 seconds"
  );
  assert(Number.isInteger(cycleUs), "ECAT_CYCLE_US must be an integer");
  assert(
    cycleUs === 1000 || allowNonOneMillisecond,
    "This report uses 1 ms thresholds; set ECAT_CYCLE_US=1000 or explicitly set ECAT_ALLOW_NON_1MS=1"
  );
  assert(existsSync(binary), `Native core binary not found: ${binary}`);
}

function findAdapter(adapters) {
  const normalized = adapterRef.toLowerCase();
  const matches = adapters.filter(
    (adapter) =>
      adapter.id.toLowerCase() === normalized ||
      adapter.name.toLowerCase().includes(normalized) ||
      adapter.description.toLowerCase().includes(normalized)
  );
  if (matches.length === 0) {
    throw new Error(`Adapter selector did not match an NPF adapter: ${adapterRef}`);
  }
  if (matches.length > 1) {
    const choices = matches
      .map((adapter) => `${adapter.name} (${adapter.id})`)
      .join(", ");
    throw new Error(`Adapter selector is ambiguous: ${choices}`);
  }
  return matches[0];
}

function buildReport({ status, result, error, assessment }) {
  const benchmark = latestSnapshot?.benchmark ?? null;
  const evaluated =
    assessment ??
    assessBenchmark(benchmark, {
      cycleUs,
      minimumDurationSec: 1800
    });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    status,
    result,
    error: error ?? null,
    criteria: {
      cycleUs,
      completed: evaluated.completed,
      simulated: evaluated.simulated,
      p99Us: evaluated.p99Us,
      p99AtMostUs: evaluated.p99LimitUs,
      p999Us: evaluated.p999Us,
      p999AtMostUs: evaluated.p999LimitUs,
      wkcErrors: evaluated.wkcErrors,
      noWkcErrors: true,
      p99ok: evaluated.p99ok,
      p999ok: evaluated.p999ok,
      wkcOk: evaluated.wkcOk,
      samples: evaluated.samples,
      expectedSamples: evaluated.expectedSamples,
      sampleCoverage: evaluated.sampleCoverage,
      enoughSamples: evaluated.enoughSamples,
      thresholdsMet: evaluated.thresholdsMet,
      durationQualified: evaluated.durationQualified,
      durationQualificationSec: evaluated.minimumDurationSec,
      accepted: evaluated.accepted
    },
    environment: {
      hostname: os.hostname(),
      platform: process.platform,
      release: os.release(),
      architecture: process.arch,
      cpu: os.cpus()[0]?.model ?? "unknown",
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      node: process.version
    },
    core: {
      binary,
      mode: latestSnapshot?.mode ?? null,
      version: latestSnapshot?.version ?? null,
      adapterId: latestSnapshot?.selectedAdapterId ?? null,
      cycleUs: latestSnapshot?.config.cycleUs ?? cycleUs,
      phase: latestSnapshot?.phase ?? null,
      note: "Windows scheduling is soft realtime, not a hard realtime guarantee."
    },
    benchmark,
    stderr: stderr.trim() || null
  };
}

async function writeReport(payload) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

try {
  validateInputs();
  child = spawn(binary, ["--mode", "soem"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  lines = readline.createInterface({
    input: child.stdout,
    crlfDelay: Number.POSITIVE_INFINITY
  });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      stderr += `\nInvalid JSON from core: ${line}`;
      return;
    }
    if (message.type === "event" && message.event === "snapshot") {
      latestSnapshot = message.data;
      return;
    }
    if (message.type !== "response" || typeof message.id !== "number") {
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) {
      return;
    }
    pending.delete(message.id);
    waiter.resolve(message);
  });

  const hello = await requiredCommand("hello");
  assert(hello.data.mode === "soem", "SOEM mode is not available in this build");

  const listed = await requiredCommand("list_adapters");
  const adapter = findAdapter(listed.data);
  await requiredCommand("select_adapter", { adapterId: adapter.id });
  await requiredCommand("update_config", {
    config: {
      adapterId: adapter.id,
      cycleUs,
      sendTimeoutUs: Math.max(cycleUs, 2000),
      receiveTimeoutUs: Math.max(cycleUs, 2000),
      autoTransitionOp: true,
      realtimePriority: true
    }
  });

  console.warn(
    `Starting EtherCAT scan and auto-OP on ${adapter.name}. Verify the machine is safe.`
  );
  await requiredCommand(
    "start",
    { adapterId: adapter.id, cycleUs, autoTransitionOp: true },
    30_000
  );
  busStarted = true;
  await requiredCommand("scan", {}, 120_000);
  const ready = await requiredCommand("get_snapshot");
  latestSnapshot = ready.data;
  assert(
    ready.data.phase === "op",
    `Benchmark requires OP, current phase is ${ready.data.phase}`
  );
  assert(ready.data.slaves.length > 0, "No EtherCAT slaves were discovered");

  await requiredCommand("benchmark_start", { durationSec });
  benchmarkStarted = true;
  console.warn(
    `Benchmark started: ${durationSec}s, ${cycleUs} us, ${ready.data.slaves.length} slaves.`
  );

  const deadline = Date.now() + durationSec * 1000 + 120_000;
  let lastProgress = -1;
  for (;;) {
    assert(Date.now() <= deadline, "Benchmark did not complete before timeout");
    await delay(1000);
    const response = await requiredCommand("get_snapshot");
    latestSnapshot = response.data;
    const benchmark = latestSnapshot.benchmark;
    const progress = Math.min(
      100,
      Math.floor((benchmark.elapsedSec / Math.max(1, benchmark.durationSec)) * 100)
    );
    if (progress >= lastProgress + 10) {
      lastProgress = progress;
      console.warn(
        `Progress ${progress}% (${benchmark.samples.toLocaleString()} samples)`
      );
    }
    if (benchmark.status === "completed") {
      benchmarkStarted = false;
      break;
    }
    if (benchmark.status === "stopped" || benchmark.status === "aborted") {
      benchmarkStarted = false;
      throw new Error(`Benchmark ended with status: ${benchmark.status}`);
    }
  }

  const assessment = assessBenchmark(latestSnapshot?.benchmark, {
    cycleUs,
    minimumDurationSec: 1800
  });
  report = buildReport({
    status: assessment.status,
    result: assessment.result,
    assessment
  });
  process.exitCode = assessment.exitCode;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  report = buildReport({ status: "failed", result: "not-accepted", error: message });
  process.exitCode = 1;
  console.error(message);
} finally {
  if (benchmarkStarted && child) {
    await command("benchmark_stop", {}, 10_000).catch(() => undefined);
  }
  if (busStarted && child) {
    await command("stop", {}, 20_000).catch(() => undefined);
  }
  lines?.close();
  child?.stdin.end();
  child?.kill();
  if (!report) {
    report = buildReport({
      status: "failed",
      result: "not-accepted",
      error: "Benchmark ended without a report"
    });
    process.exitCode = 1;
  }
  await writeReport(report);
  console.log(
    JSON.stringify(
      {
        status: report.status,
        result: report.result,
        exitCode: process.exitCode ?? 0,
        report: reportPath,
        p99Us: report.benchmark?.cycleTime?.p99Us ?? null,
        p999Us: report.benchmark?.cycleTime?.p999Us ?? null,
        samples: report.benchmark?.samples ?? 0
      },
      null,
      2
    )
  );
}
