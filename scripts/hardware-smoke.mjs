import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const adapterRef = process.env.ECAT_SOEM_ADAPTER?.trim();
if (!adapterRef) {
  throw new Error(
    "Set ECAT_SOEM_ADAPTER to an NPF adapter id, interface description, or unique name before running hardware validation."
  );
}

const binary = process.env.ECAT_CORE_BIN
  ? path.resolve(process.env.ECAT_CORE_BIN)
  : path.join(process.cwd(), "native", "build", "bin", "ecat-core.exe");
if (!existsSync(binary)) {
  throw new Error(`Native core binary not found: ${binary}`);
}

const cycleUs = Number.parseInt(process.env.ECAT_CYCLE_US ?? "1000", 10);
const autoTransitionOp = process.env.ECAT_AUTO_OP !== "0";
const child = spawn(binary, ["--mode", "soem"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true
});
const pending = new Map();
let nextId = 1;
let stderr = "";
let busStarted = false;

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
const lines = readline.createInterface({
  input: child.stdout,
  crlfDelay: Number.POSITIVE_INFINITY
});
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type !== "response") {
    return;
  }
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    waiter(message);
  }
});

function command(name, params = {}, timeoutMs = 30_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${name} timed out\n${stderr}`));
    }, timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(
      `${JSON.stringify({ id, command: name, params })}\n`
    );
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const hello = await command("hello");
  assert(hello.ok && hello.data.mode === "soem", hello.message);

  const listed = await command("list_adapters");
  assert(listed.ok, listed.message);
  const normalizedRef = adapterRef.toLowerCase();
  const adapter = listed.data.find(
    (item) =>
      item.id.toLowerCase() === normalizedRef ||
      item.description.toLowerCase().includes(normalizedRef) ||
      item.name.toLowerCase().includes(normalizedRef)
  );
  assert(
    adapter,
    `Adapter selector did not match exactly one candidate: ${adapterRef}`
  );

  const selected = await command("select_adapter", {
    adapterId: adapter.id
  });
  assert(selected.ok, selected.message);

  const configured = await command("update_config", {
    config: {
      adapterId: adapter.id,
      cycleUs,
      autoTransitionOp,
      realtimePriority: true
    }
  });
  assert(configured.ok, configured.message);

  const started = await command("start", {
    adapterId: adapter.id,
    cycleUs,
    autoTransitionOp
  });
  assert(started.ok, started.message);
  busStarted = true;

  const scanned = await command("scan", {}, 120_000);
  assert(scanned.ok, scanned.message);
  let snapshot = await command("get_snapshot");
  assert(snapshot.ok, snapshot.message);
  if (autoTransitionOp) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (snapshot.data.telemetry.wkc > 0) {
        break;
      }
      await delay(100);
      snapshot = await command("get_snapshot");
    }
    assert(
      snapshot.data.telemetry.wkc > 0,
      "Cyclic process data returned WKC=0 after entering OP"
    );
    assert(
      snapshot.data.slaves.every((slave) => slave.state === "OP"),
      "Not all slaves remained in OP"
    );
  }
  assert(snapshot.data.slaves.length > 0, "Scan returned no slaves");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        binary,
        adapter: {
          id: adapter.id,
          name: adapter.name,
          linkUp: adapter.linkUp
        },
        cycleUs,
        autoTransitionOp,
        phase: snapshot.data.phase,
        expectedWkc: scanned.data.expectedWkc,
        wkc: snapshot.data.telemetry.wkc,
        slaves: snapshot.data.slaves.map((slave) => ({
          index: slave.index,
          name: slave.name,
          state: slave.state,
          vendorId: slave.vendorId,
          productCode: slave.productCode,
          alStatusCode: slave.alStatusCode
        })),
        stderr: stderr.trim() || null
      },
      null,
      2
    )
  );
} finally {
  if (busStarted) {
    await command("stop", {}, 15_000).catch(() => undefined);
  }
  child.stdin.end();
  child.kill();
}
