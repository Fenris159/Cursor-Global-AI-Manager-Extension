"use strict";

/**
 * Package the extension as a .vsix using name and version from package.json.
 * Run: node scripts/package-vsix.js  or  npm run package-vsix
 * Output: .vsce/<name>-<version>.vsix (e.g. .vsce/cursor-global-ai-manager-1.0.0.vsix)
 */
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const pkgPath = path.join(projectRoot, "package.json");

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
} catch (err) {
  console.error("Could not read package.json:", err.message);
  process.exit(1);
}

const name = pkg.name || "extension";
const version = pkg.version || "0.0.0";
const vsixName = `${name}-${version}.vsix`;
const outDir = path.join(projectRoot, ".vsce");
const outPath = path.join(outDir, vsixName);

try {
  fs.mkdirSync(outDir, { recursive: true });
} catch (err) {
  console.error("Could not create .vsce directory:", err.message);
  process.exit(1);
}

console.log("Packaging .vsix into .vsce/...");
// Quote path so paths with spaces are not split by the shell;
// otherwise vsce receives "Projects\Cursor" as the version argument.
const outPathQuoted = process.platform === "win32" ? `"${outPath}"` : outPath;
const result = spawnSync(
  "npx",
  ["--yes", "@vscode/vsce", "package", "--out", outPathQuoted],
  { stdio: "inherit", cwd: projectRoot, shell: true }
);

if (result.status === 0) {
  console.log("Done. .vsix is in .vsce/ (" + vsixName + ")");
} else {
  console.error("Package failed. Try: npm install -g @vscode/vsce");
  console.error("Then run: vsce package --out .vsce/" + vsixName);
}
process.exit(result.status != null ? result.status : 1);
