import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import matter from "gray-matter";
import { getGlobalCursorDir, getBackupDir } from "./pathResolver";

const CATEGORIES = ["rules", "skills", "subagents", "commands", "hooks"] as const;
export type Category = (typeof CATEGORIES)[number];

const HOOKS_CONFIG_FILE = "hooks.json";
const HOOKS_SCRIPTS_DIR = "hooks";
const HOOKS_BACKUP_DIR = "Hooks_Backup";
const HOOKS_BACKUP_MAX_PER_FILE = 5;
const USER_HOOKS_COMMAND_PREFIX = "./hooks/";

/** Regex to parse a hook command string (e.g. "./hooks/after-file-edit.sh" or "node ./hooks/run.js") to the script name. */
const HOOK_COMMAND_REGEX = /(?:^node\s+)?\.\/hooks\/(.+)$/;

/** Parses a hooks.json command value to the script file name, or null if not a hook command we emit. */
export function parseHookCommandToScriptName(command: string): string | null {
  const m = String(command).match(HOOK_COMMAND_REGEX);
  return m ? m[1] : null;
}

/** Builds the command string for hooks.json. .js and .ts are run with Node so they work on all platforms. */
function hookCommandForScript(scriptName: string): string {
  const scriptPath = USER_HOOKS_COMMAND_PREFIX + scriptName;
  if (scriptName.endsWith(".js") || scriptName.endsWith(".ts")) return "node " + scriptPath;
  return scriptPath;
}

/** Cursor hook event names (camelCase). Scripts are mapped by name, e.g. after-file-edit.sh → afterFileEdit. */
const HOOKS_KNOWN_EVENTS = new Set([
  "afterAgentResponse", "afterAgentThought", "stop", "preCompact", "beforeSubmitPrompt",
  "beforeReadFile", "afterFileEdit", "beforeMCPExecution", "afterMCPExecution",
  "beforeShellExecution", "afterShellExecution", "subagentStart", "subagentStop",
  "preToolUse", "postToolUse", "postToolUseFailure", "sessionStart", "sessionEnd",
  "afterTabFileEdit", "beforeTabFileRead",
]);

/** Default hook script filenames (.sh) for the 20 known events. Used for placeholder generation. */
export const DEFAULT_HOOK_SCRIPT_NAMES: string[] = [...HOOKS_KNOWN_EVENTS].sort().map((event) => {
  const kebab = event.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
  return kebab + ".sh";
});

/** Derives Cursor event name from script filename: after-file-edit.sh → afterFileEdit, after-mcp-execution.sh → afterMCPExecution, etc. */
function scriptNameToEvent(scriptName: string): string {
  const base = scriptName.replace(/\.(sh|js|ts)$/i, "").trim();
  const camel = base.replace(/-([a-z])/gi, (_, c) => c.toUpperCase());
  if (HOOKS_KNOWN_EVENTS.has(camel)) return camel;
  const lower = camel.toLowerCase();
  const match = [...HOOKS_KNOWN_EVENTS].find((e) => e.toLowerCase() === lower);
  return match ?? "afterFileEdit";
}

/**
 * Ensures the global .cursor directory and subdirectories (rules, skills, subagents, commands) exist.
 * Creates any missing directories.
 */
export async function ensureGlobalCursorDirs(
  context: vscode.ExtensionContext
): Promise<void> {
  const basePath = getGlobalCursorDir(context);
  const baseUri = vscode.Uri.file(basePath);

  await vscode.workspace.fs.createDirectory(baseUri);

  for (const category of CATEGORIES) {
    const dirUri = vscode.Uri.file(path.join(basePath, category));
    await vscode.workspace.fs.createDirectory(dirUri);
  }
}

/**
 * Lists file names in a category directory (e.g. "rules").
 * For rules, subagents, commands: returns .md/.mdc file names.
 * For skills: returns "folderName/SKILL.md" for each folder that contains SKILL.md.
 */
export async function listFilesInCategory(
  context: vscode.ExtensionContext,
  category: Category
): Promise<string[]> {
  const basePath = getGlobalCursorDir(context);
  if (category === "hooks") {
    return [HOOKS_CONFIG_FILE];
  }
  const categoryUri = vscode.Uri.file(path.join(basePath, category));

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(categoryUri);
  } catch {
    return [];
  }

  const files: string[] = [];

  if (category === "skills") {
    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory) {
        const skillMdUri = vscode.Uri.file(path.join(basePath, category, name, "SKILL.md"));
        try {
          await vscode.workspace.fs.stat(skillMdUri);
          files.push(`${name}/SKILL.md`);
        } catch {
          // no SKILL.md in this folder, skip
        }
      }
    }
  } else {
    for (const [name, type] of entries) {
      if (type === vscode.FileType.File) {
        files.push(name);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Path for a hooks file: hooks.json at base, scripts at base/hooks/<name>. */
export function getHooksFilePath(basePath: string, fileName: string): string {
  if (fileName === HOOKS_CONFIG_FILE) return path.join(basePath, HOOKS_CONFIG_FILE);
  const scriptName = fileName.startsWith(HOOKS_SCRIPTS_DIR + "/") ? fileName.slice(HOOKS_SCRIPTS_DIR.length + 1) : fileName;
  return path.join(basePath, HOOKS_SCRIPTS_DIR, scriptName);
}

/** Absolute path for any category file (for openInEditor, etc.). */
export function getFilePathForCategory(
  context: vscode.ExtensionContext,
  category: Category,
  fileName: string
): string {
  const basePath = getGlobalCursorDir(context);
  if (category === "hooks") return getHooksFilePath(basePath, fileName);
  return path.join(basePath, category, fileName);
}

export interface HooksData {
  configFile: string;
  scripts: string[];
  enabledScripts: string[];
}

/** Lists hooks config file name, script names in hooks/, and which scripts are enabled in hooks.json. */
export async function getHooksData(context: vscode.ExtensionContext): Promise<HooksData> {
  const basePath = getGlobalCursorDir(context);
  const scriptsDir = path.join(basePath, HOOKS_SCRIPTS_DIR);
  let scripts: string[] = [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(scriptsDir));
    for (const [name, type] of entries) {
      if (type === vscode.FileType.File && (name.endsWith(".sh") || name.endsWith(".js") || name.endsWith(".ts"))) {
        scripts.push(name);
      }
    }
  } catch {
    // no hooks dir
  }
  scripts.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  let enabledScripts: string[] = [];
  try {
    const raw = await fs.readFile(path.join(basePath, HOOKS_CONFIG_FILE), "utf8");
    const config = JSON.parse(raw) as {
      hooks?: Record<string, Array<{ command?: string }>> | Array<{ command?: string }>;
    };
    const hooks = config.hooks;
    const seen = new Set<string>();
    if (Array.isArray(hooks)) {
      for (const entry of hooks) {
        const cmd = entry?.command;
        if (typeof cmd !== "string") continue;
        const scriptName = parseHookCommandToScriptName(cmd);
        if (scriptName) seen.add(scriptName);
      }
    } else if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
      for (const entries of Object.values(hooks)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          const cmd = entry?.command;
          if (typeof cmd !== "string") continue;
          const scriptName = parseHookCommandToScriptName(cmd);
          if (scriptName) seen.add(scriptName);
        }
      }
    }
    enabledScripts = scripts.filter((s) => seen.has(s));
  } catch {
    // no hooks.json or invalid
  }

  return { configFile: HOOKS_CONFIG_FILE, scripts, enabledScripts };
}

/** Clears hooks.json to empty config (no hooks to load). */
export async function clearHooksConfig(context: vscode.ExtensionContext): Promise<void> {
  const basePath = getGlobalCursorDir(context);
  const configPath = path.join(basePath, HOOKS_CONFIG_FILE);
  const content = stringifyHooksConfig(1, {});
  await fs.writeFile(configPath, content, "utf8");
}

/** Writes hooks config flat: one line per event with array inline. */
function stringifyHooksConfig(
  version: number,
  hooks: Record<string, Array<{ command: string }>>
): string {
  const eventKeys = Object.keys(hooks).sort();
  if (eventKeys.length === 0) {
    return `{"version":${version},"hooks":{}}\n`;
  }
  const entries = eventKeys.map((eventKey) => {
    const commands = hooks[eventKey].filter((e) => typeof e?.command === "string");
    const arr = commands.map((e) => `{"command":${JSON.stringify(e.command)}}`).join(",");
    return `  "${eventKey}":[${arr}]`;
  });
  return `{"version":${version},"hooks":{\n${entries.join(",\n")}\n}}\n`;
}

/** Adds or removes a script from hooks.json. Script is registered under the event that matches its name (e.g. before-shell-execution.sh → beforeShellExecution). */
export async function setHookScriptEnabled(
  context: vscode.ExtensionContext,
  scriptName: string,
  enabled: boolean
): Promise<void> {
  const basePath = getGlobalCursorDir(context);
  const configPath = path.join(basePath, HOOKS_CONFIG_FILE);
  let hooks: Record<string, Array<{ command: string }>> = {};
  let version = 1;
  let existingRaw: string | null = null;
  try {
    const raw = await fs.readFile(configPath, "utf8");
    existingRaw = raw;
    const config = JSON.parse(raw) as {
      version?: number;
      hooks?: Record<string, Array<{ command: string }>> | Array<{ command: string }>;
    };
    if (typeof config.version === "number") version = config.version;
    const h = config.hooks;
    if (Array.isArray(h)) {
      const arr = h.filter((e) => typeof e?.command === "string") as Array<{ command: string }>;
      if (arr.length) hooks.afterFileEdit = arr;
    } else if (h && typeof h === "object") {
      for (const [key, arr] of Object.entries(h)) {
        if (Array.isArray(arr) && arr.length) {
          hooks[key] = arr.filter((e) => typeof e?.command === "string") as Array<{ command: string }>;
        }
      }
    }
  } catch {
    // use empty hooks
  }
  const command = hookCommandForScript(scriptName);
  const plainPath = USER_HOOKS_COMMAND_PREFIX + scriptName;
  const event = scriptNameToEvent(scriptName);
  if (enabled) {
    const arr = hooks[event] || [];
    const already = arr.some((e) => e.command === command || e.command === plainPath);
    if (!already) hooks[event] = [...arr, { command }];
  } else {
    for (const key of Object.keys(hooks)) {
      hooks[key] = hooks[key].filter(
        (e) => e.command !== command && e.command !== plainPath
      );
      if (hooks[key].length === 0) delete hooks[key];
    }
  }
  if (existingRaw !== null) await backupHooksFileAndPrune(context, HOOKS_CONFIG_FILE, existingRaw);
  await fs.writeFile(configPath, stringifyHooksConfig(version, hooks), "utf8");
}

function getHookStubContent(fileName: string): string {
  return `#!/bin/bash
# Hook script: ${fileName}
# Input: JSON via stdin. Output: optional JSON via stdout. Exit 0 = success, 2 = block.
cat > /dev/null
echo '{}'
exit 0
`;
}

/** Creates a new hook script in hooks/ with a stub. Returns the script file name. */
export async function createHookScript(context: vscode.ExtensionContext, baseName: string): Promise<string> {
  const basePath = getGlobalCursorDir(context);
  const hooksDir = path.join(basePath, HOOKS_SCRIPTS_DIR);
  await fs.mkdir(hooksDir, { recursive: true });
  const safe = baseName.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "-") || "hook";
  const fileName = safe.endsWith(".sh") ? safe : safe + ".sh";
  const filePath = path.join(hooksDir, fileName);
  await fs.writeFile(filePath, getHookStubContent(fileName), "utf8");
  return fileName;
}

/** Creates hooks.json with empty hooks if it does not exist. If it exists, leaves it unchanged. */
export async function ensureHooksConfigExists(context: vscode.ExtensionContext): Promise<void> {
  const basePath = getGlobalCursorDir(context);
  const configPath = path.join(basePath, HOOKS_CONFIG_FILE);
  try {
    await fs.access(configPath);
  } catch {
    await fs.writeFile(configPath, stringifyHooksConfig(1, {}), "utf8");
  }
}

/** Creates absent default hook script files as placeholders (not added to hooks.json). Idempotent. */
export async function ensureDefaultHookPlaceholders(context: vscode.ExtensionContext): Promise<void> {
  const basePath = getGlobalCursorDir(context);
  const hooksDir = path.join(basePath, HOOKS_SCRIPTS_DIR);
  await fs.mkdir(hooksDir, { recursive: true });
  for (const fileName of DEFAULT_HOOK_SCRIPT_NAMES) {
    const filePath = path.join(hooksDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, getHookStubContent(fileName), "utf8");
    }
  }
}

/** Same as ensureDefaultHookPlaceholders; exposed for manual "Spawn placeholders" action. */
export async function spawnAbsentHookPlaceholders(context: vscode.ExtensionContext): Promise<void> {
  await ensureDefaultHookPlaceholders(context);
}

/**
 * Lists all files inside a skill folder recursively (relative paths).
 * Returns e.g. ["SKILL.md", "scripts/example-script.py", "references/REFERENCE.md", "assets/template-config.json"].
 */
export async function listSkillFolderContents(
  context: vscode.ExtensionContext,
  folderName: string
): Promise<string[]> {
  const basePath = getGlobalCursorDir(context);
  const skillDir = path.join(basePath, "skills", folderName);
  const files: string[] = [];
  async function walk(relDir: string): Promise<void> {
    const dirPath = path.join(skillDir, relDir);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
    } catch {
      return;
    }
    for (const [name, type] of entries) {
      const rel = relDir ? relDir + "/" + name : name;
      if (type === vscode.FileType.File) {
        files.push(rel);
      } else if (type === vscode.FileType.Directory) {
        await walk(rel);
      }
    }
  }
  await walk("");
  return files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * Deletes a file or folder in a category.
 * For skills: fileName is the folder name (e.g. "my-skill"); deletes the folder recursively.
 * For rules, subagents, commands: fileName is the file name; deletes the file.
 */
export async function deleteInCategory(
  context: vscode.ExtensionContext,
  category: Category,
  fileName: string
): Promise<void> {
  const basePath = getGlobalCursorDir(context);
  if (category === "hooks") {
    if (fileName === HOOKS_CONFIG_FILE) {
      await clearHooksConfig(context);
      return;
    }
    const targetPath = getHooksFilePath(basePath, fileName);
    await fs.rm(targetPath, { recursive: true, force: true });
    return;
  }
  const targetPath = path.join(basePath, category, fileName);
  await fs.rm(targetPath, { recursive: true, force: true });
}

/**
 * Reads the full text content of a file in a category directory.
 * Uses gray-matter to parse YAML frontmatter (for future use); returns raw file content.
 * Throws on error.
 */
export async function readFileContent(
  context: vscode.ExtensionContext,
  category: Category,
  fileName: string
): Promise<string> {
  const basePath = getGlobalCursorDir(context);
  const filePath = category === "hooks" ? getHooksFilePath(basePath, fileName) : path.join(basePath, category, fileName);
  const fileUri = vscode.Uri.file(filePath);
  const data = await vscode.workspace.fs.readFile(fileUri);
  const raw = new TextDecoder("utf-8").decode(data);
  if (category !== "hooks") matter(raw);
  return raw;
}

/**
 * Writes text content to a file in a category directory.
 * Uses Node fs so ~/.cursor is writable even when it's outside the workspace.
 * UTF-8 encoding. Creates parent dirs if missing.
 */
export async function writeFileContent(
  context: vscode.ExtensionContext,
  category: Category,
  fileName: string,
  content: string
): Promise<void> {
  const basePath = getGlobalCursorDir(context);
  const filePath = category === "hooks" ? getHooksFilePath(basePath, fileName) : path.join(basePath, category, fileName);
  if (category === "hooks") {
    if (await pathExists(filePath)) {
      const currentContent = await fs.readFile(filePath, "utf8");
      await backupHooksFileAndPrune(context, fileName, currentContent);
    }
  } else {
    await backupBeforeOverwrite(context, category, fileName);
  }
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

/**
 * Exports a single file (rules, subagents, commands) to a user-chosen path.
 * Reads from ~/.cursor/<category>/<fileName>, writes to targetFilePath.
 */
export async function exportFileToPath(
  context: vscode.ExtensionContext,
  category: "rules" | "subagents" | "commands" | "hooks",
  fileName: string,
  targetFilePath: string
): Promise<void> {
  const content = await readFileContent(context, category, fileName);
  const dir = path.dirname(targetFilePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(targetFilePath, content, "utf8");
}

/**
 * Exports a skill folder (whole folder and contents) to a parent directory.
 * Copies ~/.cursor/skills/<folderName> to targetParentDir/<folderName>.
 */
export async function exportSkillFolderToPath(
  context: vscode.ExtensionContext,
  folderName: string,
  targetParentDir: string
): Promise<void> {
  const basePath = getGlobalCursorDir(context);
  const sourceDir = path.join(basePath, "skills", folderName);
  const destDir = path.join(targetParentDir, folderName);
  await fs.mkdir(path.dirname(destDir), { recursive: true });
  await fs.cp(sourceDir, destDir, { recursive: true });
}

/** Imports a file into ~/.cursor/hooks/. Saves as *.sh regardless of source extension. Returns the destination file name. */
export async function importFileIntoHooks(
  context: vscode.ExtensionContext,
  sourceFilePath: string
): Promise<string> {
  const basePath = getGlobalCursorDir(context);
  const hooksDir = path.join(basePath, HOOKS_SCRIPTS_DIR);
  await fs.mkdir(hooksDir, { recursive: true });
  const baseName = path.basename(sourceFilePath);
  const nameWithoutExt = path.basename(baseName, path.extname(baseName)) || baseName;
  const safe = nameWithoutExt.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "-").trim() || "imported";
  const fileName = safe.endsWith(".sh") ? safe : safe + ".sh";
  const destPath = path.join(hooksDir, fileName);
  await fs.copyFile(sourceFilePath, destPath);
  return fileName;
}

/**
 * Syncs a global file or skill folder into the workspace .cursor folder.
 * Creates workspaceRoot/.cursor/<category>/ as needed. For skills, copies the
 * whole skill folder (fileName = folder name). For rules/subagents/commands, copies one file.
 */
export async function syncToWorkspace(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  category: Category,
  fileName: string
): Promise<void> {
  const basePath = getGlobalCursorDir(context);
  const workspaceCursor = path.join(workspaceRoot, ".cursor");
  const categoryDir = path.join(workspaceCursor, category);
  await fs.mkdir(categoryDir, { recursive: true });

  if (category === "skills") {
    const folderName = fileName.indexOf("/") >= 0 ? fileName.split("/")[0] : fileName;
    const sourceDir = path.join(basePath, "skills", folderName);
    const destDir = path.join(categoryDir, folderName);
    await fs.cp(sourceDir, destDir, { recursive: true });
  } else if (category === "hooks") {
    const basePath = getGlobalCursorDir(context);
    const sourcePath = getHooksFilePath(basePath, fileName);
    const destPath =
      fileName === HOOKS_CONFIG_FILE
        ? path.join(workspaceCursor, HOOKS_CONFIG_FILE)
        : path.join(workspaceCursor, HOOKS_SCRIPTS_DIR, fileName);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const content = await readFileContent(context, category, fileName);
    await fs.writeFile(destPath, content, "utf8");
  } else {
    const sourcePath = path.join(basePath, category, fileName);
    const destPath = path.join(categoryDir, fileName);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const content = await readFileContent(context, category, fileName);
    await fs.writeFile(destPath, content, "utf8");
  }
}

/** Default templates per category (Cursor docs format). */
const TEMPLATES: Record<Category, (baseName: string) => string> = {
  rules: (baseName) =>
    `---
alwaysApply: false
---

# ${baseName}

Add your rule content here. Change the rule type above to "Apply Intelligently" (add a description) or "Apply to Specific Files" (add globs), then Save.
`,

  skills: (folderNameSlug: string) => {
    const name = folderNameSlug || "my-skill";
    const title = name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return `---
name: ${name}
description: "Short description of what this skill does and when to use it."
---

# ${title}

Detailed instructions for the agent.

## When to Use

- Use this skill when...
- This skill is helpful for...

## Instructions

- Step-by-step guidance for the agent
`;
  },

  subagents: (baseName) =>
    `---
description: ""
---

# ${baseName}

Subagent instructions and context.
`,

  commands: (baseName) =>
    `# ${baseName}

What this command does when invoked with \`/${baseName.replace(/\s+/g, "-").toLowerCase()}\` in chat.
`,

  hooks: () => "", // Not used; hook scripts are created via createHookScript
};

/** Shape of rule frontmatter used for preview/UI (description, alwaysApply, globs). */
export type RuleFrontmatterPreview = {
  description: string;
  alwaysApply: boolean;
  globs: string;
};

/**
 * Parses rule file content for preview: returns raw content, body, and normalized frontmatter.
 * Single place for matter() + globs formatting so extension and normalizer stay in sync.
 */
export function parseRuleContentForPreview(content: string): {
  content: string;
  body: string;
  ruleFrontmatter: RuleFrontmatterPreview;
} {
  const parsed = matter(content);
  const data = (parsed.data as Record<string, unknown>) || {};
  const alwaysApply = data.alwaysApply === true;
  const description = data.description != null ? String(data.description).trim() : "";
  const rawGlobs = data.globs;
  const globs =
    rawGlobs == null || rawGlobs === ""
      ? ""
      : Array.isArray(rawGlobs)
        ? (rawGlobs as string[]).join(", ")
        : String(rawGlobs).trim();
  const body = typeof parsed.content === "string" ? parsed.content.trimStart() : "";
  return { content, body, ruleFrontmatter: { description, alwaysApply, globs } };
}

/**
 * Normalizes rule file content: ensures valid YAML frontmatter with alwaysApply (default false).
 * Preserves description and globs if present (Apply Intelligently / Apply to Specific Files).
 */
function normalizeRuleFrontmatter(content: string): string {
  const { body, ruleFrontmatter } = parseRuleContentForPreview(content);
  const { description, alwaysApply, globs } = ruleFrontmatter;
  const lines: string[] = ["alwaysApply: " + (alwaysApply ? "true" : "false")];
  if (description !== "") lines.push('description: "' + description.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
  if (globs !== "") lines.push("globs: " + (globs.includes(",") || globs.includes(" ") ? '"' + globs + '"' : globs));
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

/**
 * Imports a file into rules, subagents, or commands.
 * Rules: converts text extensions to .mdc and normalizes frontmatter.
 * Returns the target fileName (e.g. "my-rule.mdc").
 */
export async function importFileIntoCategory(
  context: vscode.ExtensionContext,
  category: "rules" | "subagents" | "commands",
  sourceFilePath: string
): Promise<string> {
  const basePath = getGlobalCursorDir(context);
  const raw = await fs.readFile(sourceFilePath, "utf8");
  const baseName = path.basename(sourceFilePath, path.extname(sourceFilePath));
  const safeName = baseName.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "-") || "imported";

  let targetFileName: string;
  let content: string;

  if (category === "rules") {
    targetFileName = safeName + ".mdc";
    content = normalizeRuleFrontmatter(raw);
  } else {
    targetFileName = safeName + ".md";
    content = raw;
  }

  const destPath = path.join(basePath, category, targetFileName);
  await backupBeforeOverwrite(context, category, targetFileName);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, content, "utf8");
  return targetFileName;
}

/**
 * Imports a skill folder wholesale into ~/.cursor/skills/.
 * Returns the skill folder name (e.g. "my-skill").
 */
export async function importSkillFolder(
  context: vscode.ExtensionContext,
  sourceDirPath: string
): Promise<string> {
  const basePath = getGlobalCursorDir(context);
  const folderName = path.basename(sourceDirPath);
  const safeName = folderName
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "") || "imported-skill";
  const destDir = path.join(basePath, "skills", safeName);
  await backupBeforeOverwrite(context, "skills", safeName);
  await fs.mkdir(destDir, { recursive: true });
  await fs.cp(sourceDirPath, destDir, { recursive: true });
  return safeName;
}

/**
 * Imports a single SKILL.md (or similar) file: creates a new skill folder, derives name from file content,
 * writes SKILL.md, and creates any missing template structure (scripts, references, assets).
 * Returns the skill entry (e.g. "my-skill/SKILL.md").
 */
export async function importSkillFromFile(
  context: vscode.ExtensionContext,
  sourceFilePath: string
): Promise<string> {
  const basePath = getGlobalCursorDir(context);
  const raw = await fs.readFile(sourceFilePath, "utf8");
  const match = raw.match(/^name\s*:\s*(.+)$/im);
  const rawName = match ? match[1].trim() : path.basename(sourceFilePath, path.extname(sourceFilePath));
  const safeName = rawName
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "") || "imported-skill";

  const skillRoot = path.join(basePath, "skills", safeName);
  await backupBeforeOverwrite(context, "skills", `${safeName}/SKILL.md`);
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), raw, "utf8");

  const scriptsDir = path.join(skillRoot, "scripts");
  const referencesDir = path.join(skillRoot, "references");
  const assetsDir = path.join(skillRoot, "assets");

  if (!(await pathExists(scriptsDir))) {
    await fs.mkdir(scriptsDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptsDir, "example-script.py"),
      "# Placeholder: add executable scripts the agent can run.\n# Reference from SKILL.md using relative paths, e.g. scripts/example-script.py\n",
      "utf8"
    );
  }
  if (!(await pathExists(referencesDir))) {
    await fs.mkdir(referencesDir, { recursive: true });
    await fs.writeFile(
      path.join(referencesDir, "REFERENCE.md"),
      "# Reference\n\nDetailed docs or examples loaded only when needed. Reference from SKILL.md.\n",
      "utf8"
    );
  }
  if (!(await pathExists(assetsDir))) {
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(
      path.join(assetsDir, "template-config.json"),
      '{\n  "_comment": "Placeholder: add static configs, templates, or schemas the skill may reference."\n}\n',
      "utf8"
    );
  }

  return `${safeName}/SKILL.md`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Filesystem-safe timestamp for backup folder names (e.g. 20250302T143045). */
function backupTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[-:]/g, "");
}

/** Path to ~/.cursor/Hooks_Backup (or custom base + Hooks_Backup). */
function getHooksBackupDir(context: vscode.ExtensionContext): string {
  return path.join(getGlobalCursorDir(context), HOOKS_BACKUP_DIR);
}

/**
 * Backs up hooks config or a hook script to Hooks_Backup with format <timestamp>-<fileName>.bak.
 * Keeps only the last HOOKS_BACKUP_MAX_PER_FILE backups per logical file (by fileName).
 */
export async function backupHooksFileAndPrune(
  context: vscode.ExtensionContext,
  fileName: string,
  currentContent: string
): Promise<void> {
  const backupRoot = getHooksBackupDir(context);
  await fs.mkdir(backupRoot, { recursive: true });
  const ts = backupTimestamp();
  const safeName = fileName.replace(/[/\\]/g, "-");
  const backupFileName = `${ts}-${safeName}.bak`;
  const backupPath = path.join(backupRoot, backupFileName);
  await fs.writeFile(backupPath, currentContent, "utf8");
  const pattern = "*-" + safeName + ".bak";
  let entries: string[];
  try {
    entries = await fs.readdir(backupRoot);
  } catch {
    return;
  }
  const matches = entries.filter((e) => {
    if (e.length < pattern.length) return false;
    return e.endsWith("-" + safeName + ".bak");
  });
  if (matches.length <= HOOKS_BACKUP_MAX_PER_FILE) return;
  matches.sort();
  const toRemove = matches.length - HOOKS_BACKUP_MAX_PER_FILE;
  for (let i = 0; i < toRemove; i++) {
    try {
      await fs.unlink(path.join(backupRoot, matches[i]));
    } catch {
      // ignore
    }
  }
}

/**
 * If the target file or skill folder exists in the global .cursor dir, copies it to
 * ~/.cursor/.backups/<timestamp>-<category>-<name> before any overwrite.
 * No-op if the target does not exist. Creates .backups dir as needed.
 */
export async function backupBeforeOverwrite(
  context: vscode.ExtensionContext,
  category: Category,
  fileName: string
): Promise<void> {
  const basePath = getGlobalCursorDir(context);
  const backupRoot = getBackupDir(context);
  const ts = backupTimestamp();

  if (category === "skills") {
    const folderName = fileName.indexOf("/") >= 0 ? fileName.split("/")[0] : fileName;
    const sourceDir = path.join(basePath, "skills", folderName);
    if (!(await pathExists(sourceDir))) return;
    const destDir = path.join(backupRoot, `${ts}-skills-${folderName}`);
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.cp(sourceDir, destDir, { recursive: true });
  } else {
    const sourcePath = path.join(basePath, category, fileName);
    if (!(await pathExists(sourcePath))) return;
    const safeName = fileName.replace(/[/\\]/g, "-");
    const destPath = path.join(backupRoot, `${ts}-${category}-${safeName}`);
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.cp(sourcePath, destPath);
  }
}

/**
 * Creates a new file (and folder for skills) with the category template.
 * For skills, baseName is the folder name; creates <baseName>/SKILL.md.
 * For others, baseName is the file name without extension; adds .mdc for rules, .md for subagents/commands.
 * Returns the fileName used (e.g. "my-rule.mdc" or "my-skill/SKILL.md").
 */
export async function createFileWithTemplate(
  context: vscode.ExtensionContext,
  category: Category,
  baseName: string
): Promise<string> {
  const basePath = getGlobalCursorDir(context);
  const safeName = baseName.trim().replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "-") || "untitled";

  if (category === "skills") {
    const folderName = safeName.toLowerCase().replace(/[^a-z0-9-]/g, "") || "my-skill";
    const skillRoot = path.join(basePath, category, folderName);
    await backupBeforeOverwrite(context, "skills", folderName);
    const skillRootUri = vscode.Uri.file(skillRoot);
    await vscode.workspace.fs.createDirectory(skillRootUri);

    const write = (relativePath: string, content: string) =>
      vscode.workspace.fs.writeFile(
        vscode.Uri.file(path.join(skillRoot, relativePath)),
        new TextEncoder().encode(content)
      );

    await write("SKILL.md", TEMPLATES.skills(folderName));

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(skillRoot, "scripts")));
    await write(
      "scripts/example-script.py",
      "# Placeholder: add executable scripts the agent can run.\n# Reference from SKILL.md using relative paths, e.g. scripts/example-script.py\n"
    );

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(skillRoot, "references")));
    await write(
      "references/REFERENCE.md",
      "# Reference\n\nDetailed docs or examples loaded only when needed. Reference from SKILL.md.\n"
    );

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(skillRoot, "assets")));
    await write(
      "assets/template-config.json",
      '{\n  "_comment": "Placeholder: add static configs, templates, or schemas the skill may reference."\n}\n'
    );

    return `${folderName}/SKILL.md`;
  }

  const ext = category === "rules" ? ".mdc" : ".md";
  const fileName = safeName.endsWith(ext) ? safeName : safeName + ext;
  const content = TEMPLATES[category](baseName.trim() || fileName.replace(ext, ""));
  await writeFileContent(context, category, fileName, content);
  return fileName;
}
