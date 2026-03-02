import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import matter from "gray-matter";
import { getGlobalCursorDir, getBackupDir } from "./pathResolver";

const CATEGORIES = ["rules", "skills", "subagents", "commands"] as const;
export type Category = (typeof CATEGORIES)[number];

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
  const fileUri = vscode.Uri.file(path.join(basePath, category, fileName));
  const data = await vscode.workspace.fs.readFile(fileUri);
  const raw = new TextDecoder("utf-8").decode(data);
  // Parse frontmatter so we can use it later (e.g. enable/disable, validation)
  matter(raw);
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
  const filePath = path.join(basePath, category, fileName);
  await backupBeforeOverwrite(context, category, fileName);
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
  category: "rules" | "subagents" | "commands",
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
