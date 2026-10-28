import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") {
  console.log("Windows executable patching skipped on this platform.");
  process.exit(0);
}

const root = process.cwd();
const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8")
);
const unpackedDir =
  process.argv[2] ?? path.join(root, "release", "win-unpacked");
const executable = path.join(unpackedDir, "ECAT Bench.exe");
const icon = path.join(root, "build", "icon.ico");
const rcedit = path.join(
  root,
  "node_modules",
  "rcedit",
  "bin",
  process.arch === "ia32" ? "rcedit.exe" : "rcedit-x64.exe"
);

for (const required of [executable, icon, rcedit]) {
  if (!existsSync(required)) {
    throw new Error(`Required Windows packaging input was not found: ${required}`);
  }
}

const version = packageJson.version;
const windowsVersion = `${version}.0`;
const rceditArgs = [
  executable,
  "--set-icon",
  icon,
  "--set-version-string",
  "FileDescription",
  packageJson.description,
  "--set-version-string",
  "ProductName",
  "ECAT Bench",
  "--set-version-string",
  "CompanyName",
  packageJson.author,
  "--set-version-string",
  "LegalCopyright",
  `Copyright (C) ${new Date().getFullYear()} ECAT Bench Contributors`,
  "--set-version-string",
  "InternalName",
  "ECAT Bench",
  "--set-version-string",
  "OriginalFilename",
  "ECAT Bench.exe",
  "--set-file-version",
  windowsVersion,
  "--set-product-version",
  windowsVersion
];

const result = spawnSync(rcedit, rceditArgs, {
  encoding: "utf8",
  windowsHide: true
});
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(
    `rcedit failed with exit code ${result.status}\n${result.stdout}\n${result.stderr}`
  );
}

console.log(
  `Windows executable metadata and icon applied: ${path.relative(root, executable)}`
);
