import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import electronPath from "electron";

const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
  {
    stdio: "inherit",
    env: { ...process.env, ECAT_BENCH_DEV: "1" }
  }
);

let electron;
let shuttingDown = false;

async function waitForVite() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:5173");
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }
    await delay(250);
  }
  throw new Error("Vite dev server did not become ready.");
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  electron?.kill();
  vite.kill();
  process.exitCode = code;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  await waitForVite();
  electron = spawn(electronPath, ["."], {
    stdio: "inherit",
    env: {
      ...process.env,
      ECAT_BENCH_DEV: "1",
      VITE_DEV_SERVER_URL: "http://127.0.0.1:5173"
    }
  });
  electron.on("exit", (code) => shutdown(code ?? 0));
} catch (error) {
  console.error(error);
  shutdown(1);
}
