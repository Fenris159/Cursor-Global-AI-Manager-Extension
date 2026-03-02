"use strict";

/**
 * Compile the extension (TypeScript → out/).
 * Run from anywhere: node scripts/compile.js  or  scripts\compile.cmd (Windows)
 * Uses only relative paths; no personal folder names.
 */
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const tscPath = path.join(projectRoot, "node_modules", "typescript", "bin", "tsc");
const configPath = path.join(projectRoot, "tsconfig.json");

const result = spawnSync(process.execPath, [tscPath, "-p", configPath], {
  stdio: "inherit",
  cwd: projectRoot,
  shell: false,
});

if (result.status === 0) {
  console.log("Compile succeeded. Output is in out/");
} else {
  console.error("Compile failed with exit code " + result.status);
}
process.exit(result.status ?? 1);
