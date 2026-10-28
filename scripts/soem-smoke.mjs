import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";

const binary = process.env.ECAT_CORE_BIN
  ? path.resolve(process.env.ECAT_CORE_BIN)
  : path.join(process.cwd(), "native", "build", "bin", "ecat-core.exe");

if (!existsSync(binary)) {
  throw new Error(`Native core binary not found: ${binary}`);
}

const child = spawn(binary, ["--mode", "soem"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true
});
const pending = new Map();
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
    throw new Error(`Invalid JSON from physical core: ${line}`);
  }
  if (message.type !== "response") {
    return;
  }
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    waiter(message);
  }
});

function command(name, params = {}) {
  const id = nextId++;
  const payload = `${JSON.stringify({ id, command: name, params })}\n`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(`Physical core command timed out: ${name}\n${stderr}`)
      );
    }, 15_000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      resolve(message);
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
  assert(hello.data.mode === "soem", "SOEM mode was not selected");
  assert(hello.data.capabilities.hardware === true, "Hardware capability missing");
  assert(hello.data.capabilities.native === true, "Native capability missing");

  const adaptersResponse = await command("list_adapters");
  assert(adaptersResponse.ok, adaptersResponse.message);
  const adapters = adaptersResponse.data;
  assert(Array.isArray(adapters), "Adapter response is not an array");
  assert(adapters.length > 0, "No NPF adapters were found; verify Npcap");
  assert(
    adapters.every(
      (adapter) =>
        typeof adapter.id === "string" &&
        adapter.id.startsWith("\\Device\\NPF_") &&
        typeof adapter.linkUp === "boolean" &&
        !adapter.name.toLowerCase().includes("loopback")
    ),
    "Adapter payload does not match the NPF schema"
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        binary,
        mode: hello.data.mode,
        stderr: stderr.trim() || null,
        adapters: adapters.map((adapter) => ({
          id: adapter.id,
          name: adapter.name,
          linkUp: adapter.linkUp
        }))
      },
      null,
      2
    )
  );
} finally {
  child.stdin.end();
  child.kill();
}
