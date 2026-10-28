import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { _electron as electron } from "playwright-core";

const root = process.cwd();
const executable = path.resolve(
  process.env.ECAT_PACKAGED_EXE ??
    path.join(root, "release", "win-unpacked", "ECAT Bench.exe")
);
const nativeCore = path.join(
  path.dirname(executable),
  "resources",
  "native",
  "ecat-core.exe"
);

for (const required of [executable, nativeCore]) {
  if (!existsSync(required)) {
    throw new Error(`Packaged application input is missing: ${required}`);
  }
}

const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const app = await electron.launch({
  executablePath: executable,
  args: [],
  env: {
    ...process.env,
    ECAT_CORE_MODE: "sim"
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
  await page.locator(".overview-grid").waitFor({ timeout: 20000 });

  const runtime = await page.evaluate(async () => {
    const bridge = window.ecatBridge;
    if (!bridge) {
      throw new Error("Packaged preload bridge is unavailable");
    }
    const snapshot = await bridge.getSnapshot();
    const adapters = await bridge.listAdapters();
    return {
      native: snapshot.capabilities.native === true,
      mode: snapshot.mode,
      adapters: adapters.length,
      version: snapshot.version
    };
  });
  if (!runtime.native || runtime.mode !== "simulator") {
    throw new Error(`Packaged app did not use native simulator: ${JSON.stringify(runtime)}`);
  }
  if (errors.length > 0) {
    throw new Error(`Packaged renderer errors:\n${errors.join("\n")}`);
  }

  await page.screenshot({
    path: path.join(artifacts, "packaged-overview.png"),
    fullPage: false
  });
  console.log(
    JSON.stringify(
      {
        status: "passed",
        executable,
        nativeCore,
        runtime,
        screenshot: "artifacts/packaged-overview.png"
      },
      null,
      2
    )
  );
} finally {
  await app.close();
}
