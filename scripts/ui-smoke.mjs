import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const root = process.cwd();
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });

const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error("No compatible Chrome or Edge executable found.");
}

const port = 4173;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort"
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
);

let serverError = "";
server.stderr.on("data", (chunk) => {
  serverError += chunk.toString();
});

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`);
      if (response.ok) {
        return;
      }
    } catch {
      // Preview server is still starting.
    }
    await delay(150);
  }
  throw new Error(`Preview server did not start. ${serverError}`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath, headless: true });
  const errors = [];
  const desktop = await browser.newPage({
    viewport: { width: 1480, height: 920 },
    deviceScaleFactor: 1
  });
  desktop.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  desktop.on("pageerror", (error) => errors.push(error.message));
  await desktop.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  await desktop.locator(".overview-grid").waitFor();
  await desktop.screenshot({
    path: path.join(artifacts, "overview-desktop.png"),
    fullPage: false
  });

  const navChecks = [
    ["网卡与周期", ".benchmark-panel"],
    ["SDO 对象", ".sdo-layout"],
    ["PDO 过程数据", ".pdo-summary-grid"],
    ["邮箱诊断", ".mailbox-layout"],
    ["FoE 固件", ".foe-layout"],
    ["工作区设置", ".settings-layout"]
  ];
  for (const [label, selector] of navChecks) {
    await desktop.getByRole("button", { name: label, exact: true }).click();
    await desktop.locator(selector).waitFor();
  }
  await desktop.getByRole("button", { name: "网卡与周期", exact: true }).click();
  await desktop.locator(".benchmark-panel").waitFor();
  await desktop.getByRole("button", { name: "停止总线", exact: true }).click();
  await desktop.getByRole("button", { name: "启动总线", exact: true }).waitFor();
  await desktop.getByRole("button", { name: "刷新列表", exact: true }).click();
  await desktop.getByText(/网卡列表已刷新/).waitFor();
  await desktop.getByRole("button", { name: "扫描从站", exact: true }).click();
  await desktop.getByRole("button", { name: "停止总线", exact: true }).waitFor();
  await desktop.locator(".benchmark-duration input").fill("10");
  await desktop.getByRole("button", { name: "开始基准", exact: true }).click();
  await desktop.getByText("采集中", { exact: true }).waitFor();
  await desktop.getByRole("button", { name: "停止基准", exact: true }).click();
  await desktop.getByText("已停止", { exact: true }).waitFor();
  await desktop.locator(".benchmark-panel").scrollIntoViewIfNeeded();
  await desktop.screenshot({
    path: path.join(artifacts, "adapters-desktop.png"),
    fullPage: false
  });
  await desktop.getByRole("button", { name: "SDO 对象", exact: true }).click();
  await desktop.locator(".sdo-layout").waitFor();
  await desktop.screenshot({
    path: path.join(artifacts, "sdo-desktop.png"),
    fullPage: false
  });

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1
  });
  mobile.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`mobile: ${message.text()}`);
    }
  });
  mobile.on("pageerror", (error) => errors.push(`mobile: ${error.message}`));
  await mobile.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  await mobile.locator(".overview-grid").waitFor();
  await mobile.screenshot({
    path: path.join(artifacts, "overview-mobile.png"),
    fullPage: false
  });
  await mobile.getByRole("button", { name: "网卡与周期", exact: true }).click();
  await mobile.locator(".benchmark-panel").waitFor();
  await mobile.locator(".benchmark-panel").scrollIntoViewIfNeeded();
  await mobile.screenshot({
    path: path.join(artifacts, "adapters-mobile.png"),
    fullPage: false
  });

  const overflow = await desktop.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    bodyHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight
  }));
  const mobileOverflow = await mobile.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    bodyHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight
  }));
  if (overflow.bodyWidth > overflow.viewportWidth + 1) {
    errors.push(
      `Desktop horizontal overflow: ${overflow.bodyWidth} > ${overflow.viewportWidth}`
    );
  }
  if (mobileOverflow.bodyWidth > mobileOverflow.viewportWidth + 1) {
    errors.push(
      `Mobile horizontal overflow: ${mobileOverflow.bodyWidth} > ${mobileOverflow.viewportWidth}`
    );
  }
  if (errors.length > 0) {
    throw new Error(`UI smoke check failed:\n${errors.join("\n")}`);
  }
  console.log(
    JSON.stringify(
      {
        status: "passed",
        executablePath,
        pages: navChecks.map(([label]) => label),
        screenshots: [
          "artifacts/overview-desktop.png",
          "artifacts/adapters-desktop.png",
          "artifacts/sdo-desktop.png",
          "artifacts/overview-mobile.png",
          "artifacts/adapters-mobile.png"
        ],
        overflow,
        mobileOverflow
      },
      null,
      2
    )
  );
} finally {
  await browser?.close();
  server.kill();
}
