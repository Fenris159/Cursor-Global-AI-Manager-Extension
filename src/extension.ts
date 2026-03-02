import type { FSWatcher } from "fs";
import * as vscode from "vscode";
import type { Category } from "./fsManager";

let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  try {
    const openManagerCommand = vscode.commands.registerCommand(
      "cursorGlobalAI.openManager",
      () => {
        openManagerPanel(context);
      }
    );

    context.subscriptions.push(openManagerCommand);

    statusBarItem = vscode.window.createStatusBarItem(
      "cursorGlobalAI.manageUserAI",
      vscode.StatusBarAlignment.Left,
      100
    );
    statusBarItem.text = "$(hubot) Manage User AI";
    statusBarItem.command = "cursorGlobalAI.openManager";
    statusBarItem.tooltip = "Open Cursor Global AI Manager";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
  } catch (err) {
    void vscode.window.showErrorMessage("Cursor Global AI Manager failed to activate. Check the Developer Console for details.");
  }
}

export function deactivate(): void {
  statusBarItem?.dispose();
}

async function openManagerPanel(context: vscode.ExtensionContext): Promise<void> {
  // Load heavy modules on first open so activation stays fast (avoids "extension took >10s" warning)
  const path = await import("path");
  const fs = await import("fs");
  const { getGlobalCursorDir } = await import("./pathResolver");
  const {
    createFileWithTemplate,
    deleteInCategory,
    ensureGlobalCursorDirs,
    exportFileToPath,
    exportSkillFolderToPath,
    importFileIntoCategory,
    syncToWorkspace,
    importSkillFolder,
    importSkillFromFile,
    listFilesInCategory,
    listSkillFolderContents,
    parseRuleContentForPreview,
    readFileContent,
    writeFileContent,
  } = await import("./fsManager");

  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

  const panel = vscode.window.createWebviewPanel(
    "cursorGlobalAIManager",
    "Manage User AI",
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [context.extensionUri],
    }
  );

  let lastViewedFile: { category: Category; fileName: string } | null = null;
  /** Cache parsed file content per (category, fileName) to avoid re-reading/re-parsing. Invalidated on save and on list refresh. */
  type CachedEntry = { content: string; ruleFrontmatter?: { description: string; alwaysApply: boolean; globs: string }; body?: string };
  const parsedCache = new Map<string, CachedEntry>();

  function parsedCacheKey(category: Category, fileName: string): string {
    return `${category}:${fileName}`;
  }

  function invalidateParsedCache(category?: Category, fileName?: string): void {
    if (category != null && fileName != null) parsedCache.delete(parsedCacheKey(category, fileName));
    else parsedCache.clear();
  }

  function errorMessage(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
  }

  function postFileContentReply(
    webviewPanel: typeof panel,
    cached: CachedEntry,
    category: Category,
    fileName: string
  ): void {
    if (cached.ruleFrontmatter) {
      webviewPanel.webview.postMessage({
        type: "getFileContentReply",
        content: cached.content,
        body: cached.body,
        ruleFrontmatter: cached.ruleFrontmatter,
        category,
        fileName,
      });
    } else {
      webviewPanel.webview.postMessage({
        type: "getFileContentReply",
        content: cached.content,
        category,
        fileName,
      });
    }
  }

  async function refreshPanelLists(): Promise<void> {
    const [rulesFiles, skillsFiles, subagentsFiles, commandsFiles] = await Promise.all([
      listFilesInCategory(context, "rules"),
      listFilesInCategory(context, "skills"),
      listFilesInCategory(context, "subagents"),
      listFilesInCategory(context, "commands"),
    ]);
    invalidateParsedCache();
    panel.webview.postMessage({
      type: "refreshLists",
      fileLists: { rules: rulesFiles, skills: skillsFiles, subagents: subagentsFiles, commands: commandsFiles },
      workspaceOpen: !!(vscode.workspace.workspaceFolders?.length),
    });
  }

  panel.onDidChangeViewState(
    async (e) => {
      if (!e.webviewPanel.visible || !lastViewedFile) return;
      const key = parsedCacheKey(lastViewedFile.category, lastViewedFile.fileName);
      try {
        let cached = parsedCache.get(key);
        if (!cached) {
          const content = await readFileContent(
            context,
            lastViewedFile.category,
            lastViewedFile.fileName
          );
          cached =
            lastViewedFile.category === "rules"
              ? (() => {
                  const parsed = parseRuleContentForPreview(content);
                  return { content, body: parsed.body, ruleFrontmatter: parsed.ruleFrontmatter };
                })()
              : { content };
          parsedCache.set(key, cached);
        }
        postFileContentReply(panel, cached, lastViewedFile.category, lastViewedFile.fileName);
      } catch (_) {
        // ignore; preview stays as-is
      }
    },
    null,
    context.subscriptions
  );

  await ensureGlobalCursorDirs(context);
  const [rulesFiles, skillsFiles, subagentsFiles, commandsFiles] = await Promise.all([
    listFilesInCategory(context, "rules"),
    listFilesInCategory(context, "skills"),
    listFilesInCategory(context, "subagents"),
    listFilesInCategory(context, "commands"),
  ]);

  const toolkitUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(
      context.extensionUri,
      "node_modules",
      "@vscode",
      "webview-ui-toolkit",
      "dist",
      "toolkit.min.js"
    )
  );

  panel.webview.html = getMinimalHtml(
    toolkitUri.toString(),
    panel.webview.cspSource,
    rulesFiles,
    skillsFiles,
    subagentsFiles,
    commandsFiles,
    !!(vscode.workspace.workspaceFolders?.length)
  );

  panel.webview.onDidReceiveMessage(
    async (msg: {
      type: string;
      category?: Category;
      fileName?: string;
      content?: string;
      url?: string;
      folderName?: string;
    }) => {
      if (msg.type === "openLink" && typeof msg.url === "string" && msg.url.startsWith("https://")) {
        try {
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        } catch (_) {}
        return;
      }
      if (msg.type === "createNewFile" && msg.category && isValidCategory(msg.category)) {
        const placeholders: Record<Category, string> = {
          rules: "e.g. typescript-standards",
          skills: "e.g. deploy-app",
          subagents: "e.g. code-reviewer",
          commands: "e.g. run-tests",
        };
        const fileName = await vscode.window.showInputBox({
          title: `New ${msg.category.slice(0, 1).toUpperCase() + msg.category.slice(1)}`,
          prompt: `Name (no path; .mdc for rules, folder for skills, .md for others)`,
          placeHolder: placeholders[msg.category],
          validateInput: (value) => {
            const trimmed = value.trim();
            if (!trimmed) return "Enter a name.";
            if (/[<>:"/\\|?*]/.test(trimmed)) return "Name cannot contain <>:\"/\\|?*";
            return null;
          },
        });
        if (fileName == null) return;
        try {
          const created = await createFileWithTemplate(context, msg.category, fileName.trim());
          await refreshPanelLists();
          panel.webview.postMessage({ type: "createNewFileReply", category: msg.category, fileName: created });
        } catch (err) {
          panel.webview.postMessage({
            type: "createNewFileReply",
            error: errorMessage(err, "Failed to create file"),
          });
        }
        return;
      }
      if (msg.type === "getFileContent" && msg.category && msg.fileName) {
        if (!isValidCategory(msg.category) || !isSafeFilePathForCategory(msg.category, msg.fileName)) {
          panel.webview.postMessage({
            type: "getFileContentReply",
            error: "Invalid request",
          });
          return;
        }
        try {
          lastViewedFile = { category: msg.category, fileName: msg.fileName };
          const key = parsedCacheKey(msg.category, msg.fileName);
          let cached = parsedCache.get(key);
          if (!cached) {
            const content = await readFileContent(context, msg.category, msg.fileName);
            cached =
              msg.category === "rules"
                ? (() => {
                    const parsed = parseRuleContentForPreview(content);
                    return { content, body: parsed.body, ruleFrontmatter: parsed.ruleFrontmatter };
                  })()
                : { content };
            parsedCache.set(key, cached);
          }
          postFileContentReply(panel, cached, msg.category, msg.fileName);
        } catch (err) {
          panel.webview.postMessage({
            type: "getFileContentReply",
            error: errorMessage(err, "Read failed"),
          });
        }
      } else if (msg.type === "saveFile" && msg.category && msg.fileName && typeof msg.content === "string") {
        if (!isValidCategory(msg.category) || !isSafeFilePathForCategory(msg.category, msg.fileName)) {
          panel.webview.postMessage({ type: "saveFileReply", error: "Invalid request" });
          return;
        }
        try {
          await writeFileContent(context, msg.category, msg.fileName, msg.content);
          invalidateParsedCache(msg.category, msg.fileName);
          panel.webview.postMessage({ type: "saveFileReply" });
        } catch (err) {
          const errMsg = errorMessage(err, "Save failed");
          panel.webview.postMessage({ type: "saveFileReply", error: errMsg });
        }
      } else if (msg.type === "getSkillFolderContents" && typeof msg.folderName === "string") {
        if (!isSafeFileName(msg.folderName)) {
          panel.webview.postMessage({ type: "getSkillFolderContentsReply", error: "Invalid folder name" });
          return;
        }
        try {
          const entries = await listSkillFolderContents(context, msg.folderName);
          panel.webview.postMessage({
            type: "getSkillFolderContentsReply",
            folderName: msg.folderName,
            entries,
          });
        } catch (err) {
          panel.webview.postMessage({
            type: "getSkillFolderContentsReply",
            error: errorMessage(err, "Failed to list folder"),
          });
        }
      } else if (msg.type === "openSkillFolderInNewWindow" && typeof msg.folderName === "string") {
        if (!isSafeFileName(msg.folderName)) {
          return;
        }
        try {
          const skillFolderPath = path.join(getGlobalCursorDir(context), "skills", msg.folderName);
          const uri = vscode.Uri.file(skillFolderPath);
          await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
        } catch (_) {
          // openFolder can fail if user cancels or path invalid; no need to notify webview
        }
      } else if (msg.type === "importInCategory" && msg.category && isValidCategory(msg.category)) {
        try {
          if (msg.category === "skills") {
            const choice = await vscode.window.showQuickPick(
              [
                { label: "Import a folder", description: "Copy an entire skill folder into Skills" },
                { label: "Import a SKILL.md file", description: "Create a new skill from a single file" },
              ],
              { title: "Import skill", placeHolder: "Choose how to import" }
            );
            if (!choice) {
              panel.webview.postMessage({ type: "importReply", cancelled: true });
              return;
            }
            if (choice.label === "Import a folder") {
              const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: "Select skill folder to import",
              });
              if (!uris?.length) {
                panel.webview.postMessage({ type: "importReply", cancelled: true });
                return;
              }
              const folderName = await importSkillFolder(context, uris[0].fsPath);
              await refreshPanelLists();
              panel.webview.postMessage({ type: "importReply", category: "skills", fileName: `${folderName}/SKILL.md` });
            } else {
              const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                title: "Select SKILL.md (or similar) file",
                filters: { "Markdown / text": ["md", "mdc", "txt"], "All files": ["*"] },
              });
              if (!uris?.length) {
                panel.webview.postMessage({ type: "importReply", cancelled: true });
                return;
              }
              const fileName = await importSkillFromFile(context, uris[0].fsPath);
              await refreshPanelLists();
              panel.webview.postMessage({ type: "importReply", category: "skills", fileName });
            }
          } else {
            const uris = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: false,
              title: `Import file into ${msg.category}`,
              filters:
                msg.category === "rules"
                  ? { "Rules / Markdown": ["mdc", "md", "txt", "markdown"], "All files": ["*"] }
                  : { "Markdown": ["md", "txt"], "All files": ["*"] },
            });
            if (!uris?.length) {
              panel.webview.postMessage({ type: "importReply", cancelled: true });
              return;
            }
            const fileName = await importFileIntoCategory(context, msg.category, uris[0].fsPath);
            await refreshPanelLists();
            panel.webview.postMessage({ type: "importReply", category: msg.category, fileName });
          }
        } catch (err) {
          panel.webview.postMessage({
            type: "importReply",
            error: errorMessage(err, "Import failed"),
          });
        }
      } else if (msg.type === "deleteFile" && msg.category && msg.fileName) {
        if (!isValidCategory(msg.category) || !isSafeFileName(msg.fileName)) {
          panel.webview.postMessage({ type: "deleteFileReply", error: "Invalid request" });
          return;
        }
        const label =
          msg.category === "skills"
            ? `skill "${msg.fileName}"`
            : `file "${msg.fileName}"`;
        const confirm = await vscode.window.showWarningMessage(
          `Delete ${label}? This cannot be undone.`,
          "Delete",
          "Cancel"
        );
        if (confirm !== "Delete") return;
        try {
          await deleteInCategory(context, msg.category, msg.fileName);
          await refreshPanelLists();
          panel.webview.postMessage({
            type: "deleteFileReply",
            deletedCategory: msg.category,
            deletedFileName: msg.fileName,
          });
        } catch (err) {
          panel.webview.postMessage({
            type: "deleteFileReply",
            error: errorMessage(err, "Delete failed"),
          });
        }
      } else if (msg.type === "exportItem" && msg.category && msg.fileName) {
        if (!isValidCategory(msg.category)) {
          panel.webview.postMessage({ type: "exportReply", error: "Invalid request" });
          return;
        }
        try {
          if (msg.category === "skills") {
            if (!isSafeFileName(msg.fileName)) {
              panel.webview.postMessage({ type: "exportReply", error: "Invalid folder name" });
              return;
            }
            const uris = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              title: "Select folder to export skill into",
            });
            if (!uris?.length) {
              panel.webview.postMessage({ type: "exportReply", cancelled: true });
              return;
            }
            await exportSkillFolderToPath(context, msg.fileName, uris[0].fsPath);
          } else {
            if (!isSafeFilePathForCategory(msg.category, msg.fileName)) {
              panel.webview.postMessage({ type: "exportReply", error: "Invalid request" });
              return;
            }
            const defaultUri = vscode.Uri.joinPath(context.globalStorageUri, msg.fileName);
            const uri = await vscode.window.showSaveDialog({
              defaultUri,
              title: "Export file",
            });
            if (!uri) {
              panel.webview.postMessage({ type: "exportReply", cancelled: true });
              return;
            }
            await exportFileToPath(context, msg.category, msg.fileName, uri.fsPath);
          }
          panel.webview.postMessage({ type: "exportReply", category: msg.category, fileName: msg.fileName });
        } catch (err) {
          panel.webview.postMessage({
            type: "exportReply",
            error: errorMessage(err, "Export failed"),
          });
        }
      } else if (msg.type === "syncToWorkspace" && msg.category && msg.fileName) {
        if (!isValidCategory(msg.category)) {
          panel.webview.postMessage({ type: "syncReply", error: "Invalid request" });
          return;
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          panel.webview.postMessage({
            type: "syncReply",
            error: "Open a workspace folder first (File → Open Folder).",
          });
          return;
        }
        try {
          if (msg.category === "skills") {
            const folderName = typeof msg.fileName === "string" && msg.fileName.indexOf("/") >= 0 ? msg.fileName.split("/")[0] : msg.fileName;
            if (!isSafeFileName(folderName)) {
              panel.webview.postMessage({ type: "syncReply", error: "Invalid folder name" });
              return;
            }
            await syncToWorkspace(context, workspaceFolder.uri.fsPath, "skills", folderName);
          } else {
            if (!isSafeFilePathForCategory(msg.category, msg.fileName)) {
              panel.webview.postMessage({ type: "syncReply", error: "Invalid request" });
              return;
            }
            await syncToWorkspace(context, workspaceFolder.uri.fsPath, msg.category, msg.fileName);
          }
          panel.webview.postMessage({ type: "syncReply", category: msg.category, fileName: msg.fileName });
        } catch (err) {
          panel.webview.postMessage({
            type: "syncReply",
            error: errorMessage(err, "Sync failed"),
          });
        }
      } else if (msg.type === "openInEditor" && msg.category && msg.fileName) {
        if (!isValidCategory(msg.category) || !isSafeFilePathForCategory(msg.category, msg.fileName)) {
          panel.webview.postMessage({
            type: "openInEditorReply",
            error: "Invalid request",
          });
          return;
        }
        const basePath = getGlobalCursorDir(context);
        const filePath = path.join(basePath, msg.category, msg.fileName);
        const uri = vscode.Uri.file(filePath);
        try {
          await vscode.commands.executeCommand("vscode.open", uri, {
            viewColumn: vscode.ViewColumn.One,
            preview: false,
          });
          panel.webview.postMessage({ type: "openInEditorReply" });
        } catch (err) {
          const raw = errorMessage(err, String(err));
          const is50Mb = raw.includes("50MB") || raw.includes("50 MB");
          const message = is50Mb
            ? "File outside workspace: add your .cursor folder to the workspace to edit here, or open the file from File Explorer."
            : "Could not open file.";
          panel.webview.postMessage({
            type: "openInEditorReply",
            error: message,
          });
        }
      }
    }
  );

  // Refresh lists when the global .cursor folder changes (e.g. user adds/edits files outside the extension)
  const globalCursorDir = getGlobalCursorDir(context);
  const DEBOUNCE_MS = 400;
  let watchTimeout: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  try {
    watcher = fs.watch(
      globalCursorDir,
      { recursive: true },
      () => {
        if (watchTimeout) clearTimeout(watchTimeout);
        watchTimeout = setTimeout(async () => {
          watchTimeout = undefined;
          try {
            await refreshPanelLists();
          } catch (_) {
            // ignore (e.g. panel disposed)
          }
        }, DEBOUNCE_MS);
      }
    );
  } catch (_) {
    // fs.watch can fail on some systems; lists still work, just no auto-refresh
  }
  panel.onDidDispose(() => {
    if (watcher) watcher.close();
    if (watchTimeout) clearTimeout(watchTimeout);
  });
}

const VALID_CATEGORIES: Category[] = ["rules", "skills", "subagents", "commands"];

function isValidCategory(cat: string): cat is Category {
  return VALID_CATEGORIES.includes(cat as Category);
}

function isSafeFileName(fileName: string): boolean {
  return (
    fileName.length > 0 &&
    !fileName.includes("..") &&
    !fileName.includes("/") &&
    !fileName.includes("\\")
  );
}

/** For skills, fileName can be a path like "folder/scripts/file.py". */
function isSafeFilePathForCategory(category: Category, fileName: string): boolean {
  if (fileName.length === 0 || fileName.includes("..") || fileName.includes("\\")) return false;
  if (category === "skills") return true; // allow "/" for paths within skill folder
  return !fileName.includes("/");
}

const DOC_URLS: Record<Category, string> = {
  rules: "https://cursor.com/docs/context/rules",
  skills: "https://cursor.com/docs/context/skills",
  subagents: "https://cursor.com/docs/context/subagents",
  commands: "https://cursor.com/docs/context/commands",
};

function getMinimalHtml(
  toolkitScriptSrc: string,
  cspSource: string,
  rulesFiles: string[],
  skillsFiles: string[],
  subagentsFiles: string[],
  commandsFiles: string[],
  workspaceOpen: boolean
): string {
  const scriptSrc = toolkitScriptSrc.replace(/"/g, "&quot;");
  const csp = cspSource.replace(/'/g, "&#39;");
  const fileLists = {
    rules: rulesFiles,
    skills: skillsFiles,
    subagents: subagentsFiles,
    commands: commandsFiles,
  };
  const fileListsJson = JSON.stringify(fileLists).replace(/<\//g, "<\\/");
  const docUrlsJson = JSON.stringify(DOC_URLS).replace(/<\//g, "<\\/");
  const workspaceOpenJson = workspaceOpen ? "true" : "false";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${csp} https://cdn.jsdelivr.net; style-src 'unsafe-inline' ${csp} https://cdn.jsdelivr.net; font-src ${csp} https://cdn.jsdelivr.net; connect-src ${csp} https://cdn.jsdelivr.net; worker-src blob:;">
  <title>Manage User AI</title>
  <script src="${scriptSrc}"><\/script>
  <script>
    (function() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', upgradeFallback);
      } else {
        upgradeFallback();
      }
      function upgradeFallback() {
        if (typeof customElements !== 'undefined' && customElements.get('vscode-button')) return;
        document.querySelectorAll('vscode-button').forEach(function(el) {
          var btn = document.createElement('button');
          btn.textContent = el.textContent;
          btn.className = 'vscode-button-fallback';
          if (el.id) btn.id = el.id;
          el.parentNode.replaceChild(btn, el);
        });
      }
    })();
  <\/script>
  <style>
    * { box-sizing: border-box; }
    html, body {
      height: 100%;
      overflow: hidden;
      margin: 0;
      padding: 0;
    }
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-size: var(--vscode-editor-font-size, 14px);
      font-weight: var(--vscode-editor-font-weight, normal);
    }
    h1 {
      margin: 0 0 0.75rem 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    p {
      margin: 0;
      color: var(--vscode-editor-foreground);
    }
    .section { margin-top: 1rem; }
    .layout { display: flex; height: 100%; min-height: 0; }
    .sidebar {
      width: 220px;
      flex-shrink: 0;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground);
      border-right: 1px solid var(--vscode-sideBar-border);
      padding: 0.5rem 0;
    }
    .main { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .main-placeholder { flex: 1; min-height: 0; overflow-y: auto; padding: 1rem 1.5rem; }
    .main-placeholder p { color: var(--vscode-descriptionForeground); }
    .editor-wrap { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    #editor-container { flex: 1; min-height: 0; }
    .rule-controls {
      padding: 0.5rem 1rem;
      border-bottom: 1px solid var(--vscode-sideBar-border);
      background: var(--vscode-editor-inactiveSelectionBackground);
      display: none;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      font-size: 0.85rem;
    }
    .rule-controls.visible { display: flex; }
    .rule-controls label { margin-right: 0.25rem; color: var(--vscode-descriptionForeground); }
    .rule-controls select, .rule-controls input[type="text"] {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 2px 6px;
      font-size: inherit;
    }
    .rule-controls input[type="text"] { min-width: 120px; }
    .rule-controls .rule-type-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .rule-controls .rule-type-row select { min-width: 200px; }
    .rule-controls .rule-extra { display: none; }
    .rule-controls .rule-extra.visible { display: inline-flex; align-items: center; gap: 0.35rem; }
    .rule-controls .rule-extra.visible input { min-width: 220px; }
    .main-footer { flex-shrink: 0; padding: 0.5rem 1rem; border-top: 1px solid var(--vscode-sideBar-border); background: var(--vscode-editor-background); display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
    #edit-status { font-size: 0.85rem; color: var(--vscode-descriptionForeground); }
    .vscode-button-fallback {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 1px solid var(--vscode-button-border, transparent);
      padding: 4px 12px;
      font-size: inherit;
      font-family: inherit;
      cursor: pointer;
      border-radius: 2px;
    }
    .vscode-button-fallback:hover {
      background: var(--vscode-button-hoverBackground);
    }
  .sidebar-readme-link {
      display: flex;
      align-items: center;
      padding: 0.5rem 0.75rem;
      font-size: 0.85rem;
      cursor: pointer;
      color: var(--vscode-sideBar-foreground);
      border-bottom: 1px solid var(--vscode-sideBar-border);
      margin-bottom: 0.25rem;
    }
    .sidebar-readme-link:hover { background: var(--vscode-list-hoverBackground); }
    .sidebar-readme-link.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .main-placeholder .readme-note {
      background: var(--vscode-textBlockQuote-background);
      border-left: 4px solid var(--vscode-focusBorder);
      color: var(--vscode-descriptionForeground);
      padding: 0.75rem 1rem;
      margin: 1rem 0;
      border-radius: 4px;
      font-size: 0.9rem;
    }
    .main-placeholder .readme-note code { font-size: 0.85em; }
    .main-placeholder .readme-warning {
      background: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      padding: 0.75rem 1rem;
      border-radius: 4px;
      margin: 1rem 0;
      font-size: 0.9rem;
    }
    .main-placeholder .readme-links { margin-top: 1.25rem; }
    .main-placeholder .readme-links a { color: var(--vscode-textLink-foreground); }
    .main-placeholder .readme-links a:hover { text-decoration: underline; }
    .main-placeholder .readme-links ul { margin: 0.5rem 0 0 1rem; padding: 0; }
    .main-placeholder .readme-links li { margin: 0.25rem 0; }
    .main-placeholder .readme-h2 { font-size: 1rem; margin: 1rem 0 0.5rem 0; font-weight: 600; }
  .sidebar-section { margin-bottom: 0.25rem; }
    .sidebar-section-header {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.4rem 0.75rem;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-sideBar-foreground);
      cursor: pointer;
      user-select: none;
    }
    .sidebar-section-header:hover { background: var(--vscode-list-hoverBackground); }
    .sidebar-section-title { flex: 1; }
    .sidebar-section-help {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.1rem;
      height: 1.1rem;
      border-radius: 50%;
      border: 1px solid var(--vscode-descriptionForeground);
      color: var(--vscode-descriptionForeground);
      text-decoration: none;
      font-size: 0.65rem;
      font-weight: 600;
      flex-shrink: 0;
    }
    .sidebar-section-help:hover {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-foreground);
    }
    .sidebar-section-import {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 0.9375rem;
      height: 0.9375rem;
      padding: 0;
      border: none;
      border-radius: 2px;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
    }
    .sidebar-section-import:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .sidebar-section-import svg { width: 0.9375rem; height: 0.9375rem; }
    .sidebar-section-chevron, .sidebar-folder-chevron:not(.sidebar-folder-chevron-hollow) {
      display: inline-block;
      width: 0;
      height: 0;
      border-top: 0.234375rem solid transparent;
      border-bottom: 0.234375rem solid transparent;
      border-left: 0.34375rem solid var(--vscode-descriptionForeground);
      transition: transform 0.15s ease;
      margin-right: 0.2rem;
      flex-shrink: 0;
    }
    .sidebar-folder-chevron-hollow {
      display: inline-flex;
      align-items: center;
      width: auto;
      height: auto;
      border: none;
      margin-right: 0.2rem;
      flex-shrink: 0;
      color: var(--vscode-descriptionForeground);
      transition: transform 0.15s ease;
    }
    .sidebar-folder-chevron-hollow svg { width: 0.46875rem; height: 0.46875rem; display: block; }
    .sidebar-section-header .sidebar-section-chevron { margin-right: 0.35rem; }
    .sidebar-section.expanded .sidebar-section-chevron, .sidebar-skill-folder.expanded .sidebar-folder-chevron:not(.sidebar-folder-chevron-hollow) { transform: rotate(90deg); }
    .sidebar-skill-folder.expanded .sidebar-folder-chevron-hollow svg { transform: rotate(90deg); }
    .sidebar-file-list {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.2s ease;
    }
    .sidebar-section.expanded .sidebar-file-list {
      max-height: 500px;
    }
    .sidebar-file-list li {
      padding: 0.35rem 0.75rem 0.35rem 1.25rem;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .sidebar-file-list li.sidebar-skill-folder-li {
      padding: 0;
    }
    .sidebar-file-list li:hover { background: var(--vscode-list-hoverBackground); }
    .sidebar-file-list li.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .sidebar-file-list li.create-new {
      color: var(--vscode-textLink-foreground);
      font-style: italic;
    }
    .sidebar-file-list li.create-new:hover { color: var(--vscode-textLink-activeForeground); }
    .sidebar-file-list .file-row, .sidebar-skill-folder .sidebar-folder-header {
      display: flex;
      align-items: center;
      gap: 0.1rem;
      padding: 0.3rem 0.4rem 0.3rem 1rem;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .sidebar-file-list .file-row .sidebar-actions, .sidebar-skill-folder .sidebar-folder-header .sidebar-actions {
      display: inline-flex;
      align-items: center;
      gap: 0.05rem;
      flex-shrink: 0;
      margin-left: auto;
    }
    .sidebar-file-list .file-row:hover, .sidebar-skill-folder .sidebar-folder-header:hover { background: var(--vscode-list-hoverBackground); }
    .sidebar-file-list .file-row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .sidebar-file-list .file-row .file-name, .sidebar-folder-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sidebar-delete-btn {
      flex-shrink: 0;
      padding: 0.12rem 0.2rem;
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-size: 0.9375rem;
      line-height: 1;
      border-radius: 2px;
    }
    .sidebar-delete-btn:hover { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-errorForeground); }
    .sidebar-sync-btn, .sidebar-export-btn {
      flex-shrink: 0;
      padding: 0.12rem 0.2rem;
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      line-height: 1;
      border-radius: 2px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .sidebar-sync-btn:hover, .sidebar-export-btn:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .sidebar-sync-btn:disabled, .sidebar-sync-btn.sidebar-sync-btn-disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
    .sidebar-sync-btn svg, .sidebar-export-btn svg { width: 0.9375rem; height: 0.9375rem; }
    .sidebar-edit-btn {
      flex-shrink: 0;
      padding: 0.12rem 0.2rem;
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      line-height: 1;
      border-radius: 2px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .sidebar-edit-btn:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .sidebar-edit-btn svg { width: 0.9375rem; height: 0.9375rem; }
    .sidebar-skill-folder { margin: 0.1rem 0; }
    .sidebar-skill-folder .sidebar-folder-header { padding-left: 0.75rem; }
    .sidebar-folder-contents {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.2s ease;
    }
    .sidebar-skill-folder.expanded .sidebar-folder-contents { max-height: 400px; }
    .sidebar-folder-contents li {
      padding: 0.25rem 0.5rem 0.25rem 1rem;
      font-size: 0.8rem;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sidebar-folder-contents li:hover { background: var(--vscode-list-hoverBackground); }
    .sidebar-folder-contents li.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  </style>
  <script>
    window.FILE_LISTS = ${fileListsJson};
    window.DOC_URLS = ${docUrlsJson};
    window.WORKSPACE_OPEN = ${workspaceOpenJson};
  <\/script>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-readme-link active" id="sidebar-readme" role="button" tabindex="0" title="Back to overview">#README</div>
      <div class="sidebar-section" data-category="rules">
        <div class="sidebar-section-header" title="Expand or collapse">
          <span class="sidebar-section-chevron" aria-hidden="true"></span>
          <span class="sidebar-section-title">Rules</span>
          <button type="button" class="sidebar-section-import" title="Import file into Rules" aria-label="Import file into Rules" data-category="rules"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-8L14.5 3zm-.51 8.5h-12v-7h4.29l.85.85.35.15H14v6z"/></svg></button>
          <a class="sidebar-section-help" href="#" title="Learn about Rules" data-url="rules" aria-label="Learn about Rules">?</a>
        </div>
        <ul class="sidebar-file-list" id="rules-list"></ul>
      </div>
      <div class="sidebar-section" data-category="skills">
        <div class="sidebar-section-header" title="Expand or collapse">
          <span class="sidebar-section-chevron" aria-hidden="true"></span>
          <span class="sidebar-section-title">Skills</span>
          <button type="button" class="sidebar-section-import" title="Import folder or SKILL.md into Skills" aria-label="Import into Skills" data-category="skills"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-8L14.5 3zm-.51 8.5h-12v-7h4.29l.85.85.35.15H14v6z"/></svg></button>
          <a class="sidebar-section-help" href="#" title="Learn about Skills" data-url="skills" aria-label="Learn about Skills">?</a>
        </div>
        <ul class="sidebar-file-list" id="skills-list"></ul>
      </div>
      <div class="sidebar-section" data-category="subagents">
        <div class="sidebar-section-header" title="Expand or collapse">
          <span class="sidebar-section-chevron" aria-hidden="true"></span>
          <span class="sidebar-section-title">Subagents</span>
          <button type="button" class="sidebar-section-import" title="Import file into Subagents" aria-label="Import file into Subagents" data-category="subagents"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-8L14.5 3zm-.51 8.5h-12v-7h4.29l.85.85.35.15H14v6z"/></svg></button>
          <a class="sidebar-section-help" href="#" title="Learn about Subagents" data-url="subagents" aria-label="Learn about Subagents">?</a>
        </div>
        <ul class="sidebar-file-list" id="subagents-list"></ul>
      </div>
      <div class="sidebar-section" data-category="commands">
        <div class="sidebar-section-header" title="Expand or collapse">
          <span class="sidebar-section-chevron" aria-hidden="true"></span>
          <span class="sidebar-section-title">Commands</span>
          <button type="button" class="sidebar-section-import" title="Import file into Commands" aria-label="Import file into Commands" data-category="commands"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-8L14.5 3zm-.51 8.5h-12v-7h4.29l.85.85.35.15H14v6z"/></svg></button>
          <a class="sidebar-section-help" href="#" title="Learn about Commands" data-url="commands" aria-label="Learn about Commands">?</a>
        </div>
        <ul class="sidebar-file-list" id="commands-list"></ul>
      </div>
    </aside>
    <main class="main">
      <div class="main-placeholder" id="main-placeholder">
        <h1>Cursor Global AI Manager</h1>
        <p>Manage user-level rules, skills, subagents, and commands that apply across all your workspaces. Changes do not apply to existing chats; start a new chat or right-click the agent in the sidebar and choose <strong>Fork chat</strong> to pick up the new settings.</p>
        <div class="readme-warning" role="alert">
          <strong>Global impact.</strong> Changes you make here apply to <em>every</em> Cursor workspace (every project and folder). Add or edit content only when you intend it to affect all projects. Consider testing in a single project first if unsure.
        </div>
        <div class="readme-note" role="note">
          <strong>Rules format.</strong> In Cursor’s native <strong>Settings → Rules</strong>, a rule with only <code>alwaysApply: false</code> and no <code>description</code> or <code>globs</code> may show “Incorrect format”. That’s expected: when a rule isn’t always applied, Cursor needs either a <strong>description</strong> (Apply Intelligently) or <strong>globs</strong> (Apply to Specific Files). Without either, the rule only applies when you <strong>@mention it</strong> in chat (Apply Manually).
        </div>
        <div class="readme-note" role="note">
          <strong>Settings → Rules “User” tab.</strong> Rules you manage here (in <code>~/.cursor/rules/</code>) may not appear under the <strong>User</strong> filter in Cursor’s native Settings → Rules. That’s a Cursor UI quirk: the “User” tab often shows only rules stored in Cursor’s internal state. Your file-based rules still apply globally and will appear under <strong>All</strong> (and in project filters). They are loaded and used by the AI.
        </div>
        <h2 class="readme-h2">How to use</h2>
        <p>Expand a category in the sidebar (Rules, Skills, Subagents, Commands), then select a file to preview it. Use <strong>Edit</strong> to open the file in the editor. Use <strong>+ Create new</strong> to add a new rule, skill, subagent, or command. For a skill folder, use the pencil icon to open that skill in a new window. Use the <strong>Import</strong> button (folder icon) in each category header to add files or skill folders from disk. Use <strong>Export</strong> (document-with-arrow) on a file or skill folder to save a copy elsewhere. Use <strong>Sync to Workspace</strong> (sync icon) to copy the selected item into this project’s <code>.cursor</code> folder so you can share it with the team (e.g. for developers who don’t have it in their global <code>~/.cursor/</code>).</p>
        <h2 class="readme-h2">Import, Export, and Sync</h2>
        <ul class="main-placeholder ul-naked" style="list-style: none; padding-left: 0; margin: 0.5rem 0 0 0;">
          <li style="margin: 0.25rem 0;"><strong>Import</strong> — Add files or skill folders from your machine into a category. Rules are normalized to valid frontmatter.</li>
          <li style="margin: 0.25rem 0;"><strong>Export</strong> — Save a copy of a file or skill folder to any location you choose.</li>
          <li style="margin: 0.25rem 0;"><strong>Sync to Workspace</strong> — Copy the selected global file or skill folder into <code>.cursor/</code> in the open workspace. Creates the folder if needed. Requires a folder to be open (File → Open Folder).</li>
        </ul>
        <div class="readme-note" role="note">
          <strong>Backups.</strong> Before any overwrite (Save, Import, or Create new with an existing name), the extension copies the current file or skill folder to <code>~/.cursor/.backups/</code> with a timestamped name (e.g. <code>20250302T143045-rules-my-rule.mdc</code> or <code>20250302T143045-skills-my-skill/</code>). To restore, copy a backup from <code>.backups/</code> back into the matching category folder under <code>~/.cursor/</code>.
        </div>
        <div class="readme-links">
          <strong>Documentation</strong>
          <ul>
            <li><a href="#" data-doc="rules">Rules</a> — How global rules guide the AI</li>
            <li><a href="#" data-doc="skills">Skills</a> — Agent skills and the .cursor folder</li>
            <li><a href="#" data-doc="subagents">Subagents</a> — Custom agent configurations</li>
            <li><a href="#" data-doc="commands">Commands</a> — Custom slash commands</li>
          </ul>
        </div>
      </div>
      <div class="editor-wrap" id="editor-wrap" style="display: none;">
        <div class="rule-controls" id="rule-controls">
          <div class="rule-type-row">
            <select id="rule-type" title="How this rule is applied">
              <option value="always">Always Apply — Apply to every chat and cmd-k session</option>
              <option value="intelligent">Apply Intelligently — When Agent decides it's relevant based on description</option>
              <option value="files">Apply to Specific Files — When file matches a specified pattern</option>
              <option value="manual">Apply Manually — When @-mentioned</option>
            </select>
            <div class="rule-extra" id="rule-input-wrap">
              <input type="text" id="rule-extra-input" placeholder="Description or glob pattern" />
            </div>
          </div>
          <vscode-button id="save-btn">Save</vscode-button>
        </div>
        <div id="editor-container"></div>
        <div class="main-footer">
          <vscode-button id="edit-btn">Edit</vscode-button>
          <span id="edit-status"></span>
        </div>
      </div>
    </main>
  </div>
  <script>
    (function() {
      var vscode = acquireVsCodeApi();
      var docUrls = window.DOC_URLS || {};
      var fileLists = window.FILE_LISTS || { rules: [], skills: [], subagents: [], commands: [] };
      function init() {
        var placeholder = document.getElementById('main-placeholder');
        var editorWrap = document.getElementById('editor-wrap');
        var editorContainer = document.getElementById('editor-container');
        var editBtn = document.getElementById('edit-btn');
        var editStatus = document.getElementById('edit-status');
        var ruleControls = document.getElementById('rule-controls');
        var ruleTypeSelect = document.getElementById('rule-type');
        var ruleExtraInput = document.getElementById('rule-extra-input');
        var ruleInputWrap = document.getElementById('rule-input-wrap');
        var saveBtn = document.getElementById('save-btn');
        if (!editBtn) return;
        var currentFile = null;
        var editor = null;
        var monacoLoaded = false;
        var MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min';
        var isRuleEditor = false;
        var ruleBody = '';

        function updateRuleTypeUI() {
          var v = ruleTypeSelect ? ruleTypeSelect.value : 'manual';
          var show = v === 'intelligent' || v === 'files';
          if (ruleInputWrap) ruleInputWrap.classList.toggle('visible', show);
          if (ruleExtraInput) {
            ruleExtraInput.placeholder = v === 'intelligent' ? 'Describe when this rule is relevant' : v === 'files' ? 'e.g. src/**/*.ts or **/*.ts' : '';
          }
        }
        function updateRulePreview() {
          if (!editor || !isRuleEditor) return;
          var fm = buildRuleFrontmatter();
          var v = ruleTypeSelect ? ruleTypeSelect.value : 'manual';
          var yaml = frontmatterToYaml(fm, v);
          var nl = String.fromCharCode(10);
          var full = '---' + nl + yaml + nl + '---' + nl + nl + ruleBody;
          editor.setValue(full);
        }
        function buildRuleFrontmatter() {
          var v = ruleTypeSelect ? ruleTypeSelect.value : 'manual';
          var extra = (ruleExtraInput && ruleExtraInput.value) ? ruleExtraInput.value.trim() : '';
          var alwaysApply = v === 'always';
          if (v === 'intelligent') return { description: extra, alwaysApply: false, globs: '' };
          if (v === 'files') return { description: '', alwaysApply: false, globs: extra };
          return { description: '', alwaysApply: alwaysApply, globs: '' };
        }
        function frontmatterToYaml(fm, ruleType) {
          var lines = [];
          lines.push('alwaysApply: ' + (fm.alwaysApply === true ? 'true' : 'false'));
          if (ruleType === 'intelligent') {
            var desc = fm.description != null ? String(fm.description) : '';
            lines.push('description: ' + (desc ? '"' + desc.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '"' : '""'));
          }
          if (ruleType === 'files') {
            lines.push('globs: ' + (fm.globs || ''));
          }
          var nl = String.fromCharCode(10);
          return lines.join(nl);
        }
        if (ruleTypeSelect) ruleTypeSelect.addEventListener('change', function() { updateRuleTypeUI(); updateRulePreview(); });
        if (ruleExtraInput) ruleExtraInput.addEventListener('input', updateRulePreview);
        if (ruleExtraInput) ruleExtraInput.addEventListener('change', updateRulePreview);
        function doSave() {
          if (!currentFile || !editor || !isRuleEditor) return;
          var fm = buildRuleFrontmatter();
          var v = ruleTypeSelect ? ruleTypeSelect.value : 'manual';
          var yaml = frontmatterToYaml(fm, v);
          var nl = String.fromCharCode(10);
          var full = '---' + nl + yaml + nl + '---' + nl + nl + ruleBody;
          if (editStatus) editStatus.textContent = 'Saving...';
          vscode.postMessage({ type: 'saveFile', category: currentFile.category, fileName: currentFile.fileName, content: full });
        }
        if (saveBtn) saveBtn.addEventListener('click', function(e) { e.preventDefault(); doSave(); });
        if (ruleControls) ruleControls.addEventListener('click', function(e) {
          if (e.target && (e.target.id === 'save-btn' || (e.target.closest && e.target.closest('#save-btn')))) { e.preventDefault(); doSave(); }
        });

        function renderCategoryList(cat, files) {
          var list = document.getElementById(cat + '-list');
          if (!list) return;
          list.innerHTML = '';
          var createLi = document.createElement('li');
          createLi.className = 'create-new';
          createLi.textContent = '+ Create new';
          createLi.setAttribute('data-create', cat);
          createLi.addEventListener('click', function(e) { e.stopPropagation(); vscode.postMessage({ type: 'createNewFile', category: cat }); });
          list.appendChild(createLi);
          if (cat === 'skills') {
            var seen = {};
            (files || []).forEach(function(entry) {
              var folderName = entry.indexOf('/') >= 0 ? entry.split('/')[0] : entry;
              if (seen[folderName]) return;
              seen[folderName] = true;
              var folderDiv = document.createElement('div');
              folderDiv.className = 'sidebar-skill-folder';
              folderDiv.setAttribute('data-folder', folderName);
              var header = document.createElement('div');
              header.className = 'sidebar-folder-header';
              var chevron = document.createElement('span');
              chevron.className = 'sidebar-folder-chevron sidebar-folder-chevron-hollow';
              chevron.setAttribute('aria-hidden', 'true');
              chevron.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
              var nameSpan = document.createElement('span');
              nameSpan.className = 'sidebar-folder-name';
              nameSpan.textContent = folderName;
              nameSpan.title = folderName;
              var syncBtn = document.createElement('button');
              syncBtn.className = 'sidebar-sync-btn';
              syncBtn.title = 'Sync to Workspace';
              syncBtn.setAttribute('aria-label', 'Sync to Workspace');
              syncBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.14645 0.646447C7.34171 0.451184 7.65829 0.451184 7.85355 0.646447L9.35355 2.14645C9.54882 2.34171 9.54882 2.65829 9.35355 2.85355L7.85355 4.35355C7.65829 4.54882 7.34171 4.54882 7.14645 4.35355C6.95118 4.15829 6.95118 3.84171 7.14645 3.64645L7.7885 3.00439C5.12517 3.11522 3 5.30943 3 8C3 9.56799 3.72118 10.9672 4.85185 11.8847C5.06627 12.0587 5.09904 12.3736 4.92503 12.588C4.75103 12.8024 4.43615 12.8352 4.22172 12.6612C2.86712 11.5619 2 9.88205 2 8C2 4.75447 4.57689 2.1108 7.79629 2.00339L7.14645 1.35355C6.95118 1.15829 6.95118 0.841709 7.14645 0.646447ZM11.075 3.41199C11.249 3.19756 11.5639 3.1648 11.7783 3.3388C13.1329 4.43806 14 6.11795 14 8C14 11.2455 11.4231 13.8892 8.20371 13.9966L8.85355 14.6464C9.04882 14.8417 9.04882 15.1583 8.85355 15.3536C8.65829 15.5488 8.34171 15.5488 8.14645 15.3536L6.64645 13.8536C6.55268 13.7598 6.5 13.6326 6.5 13.5C6.5 13.3674 6.55268 13.2402 6.64645 13.1464L8.14645 11.6464C8.34171 11.4512 8.65829 11.4512 8.85355 11.6464C9.04882 11.8417 9.04882 12.1583 8.85355 12.3536L8.2115 12.9956C10.8748 12.8848 13 10.6906 13 8C13 6.43201 12.2788 5.03283 11.1482 4.1153C10.9337 3.94129 10.901 3.62641 11.075 3.41199Z"/></svg>';
              if (!window.WORKSPACE_OPEN) { syncBtn.disabled = true; syncBtn.classList.add('sidebar-sync-btn-disabled'); syncBtn.title = 'Sync to Workspace (open a folder first)'; }
              else { syncBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'syncToWorkspace', category: 'skills', fileName: folderName }); }); }
              var editBtn = document.createElement('button');
              editBtn.className = 'sidebar-edit-btn';
              editBtn.title = 'Edit in new window';
              editBtn.setAttribute('aria-label', 'Edit in new window');
              editBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/></svg>';
              editBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'openSkillFolderInNewWindow', folderName: folderName }); });
              var exportBtn = document.createElement('button');
              exportBtn.className = 'sidebar-export-btn';
              exportBtn.title = 'Export';
              exportBtn.setAttribute('aria-label', 'Export');
              exportBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9 1H2v14h9v-2H4V3h4V1H9zm0 2.4L11.6 5H9V3.4zM11 9l2 2v-2h2v-1h-2V7h-1v2H9v1h2z"/></svg>';
              exportBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'exportItem', category: 'skills', fileName: folderName }); });
              var delBtn = document.createElement('button');
              delBtn.className = 'sidebar-delete-btn';
              delBtn.title = 'Delete skill';
              delBtn.setAttribute('aria-label', 'Delete');
              delBtn.textContent = '\uD83D\uDDD1';
              delBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'deleteFile', category: 'skills', fileName: folderName }); });
              var actionsWrap = document.createElement('span');
              actionsWrap.className = 'sidebar-actions';
              actionsWrap.appendChild(syncBtn);
              actionsWrap.appendChild(editBtn);
              actionsWrap.appendChild(exportBtn);
              actionsWrap.appendChild(delBtn);
              header.appendChild(chevron);
              header.appendChild(nameSpan);
              header.appendChild(actionsWrap);
              var contentsUl = document.createElement('ul');
              contentsUl.className = 'sidebar-folder-contents';
              contentsUl.setAttribute('data-folder', folderName);
              header.addEventListener('click', function(e) {
                if (e.target.closest('.sidebar-actions')) return;
                folderDiv.classList.toggle('expanded');
                if (folderDiv.classList.contains('expanded') && contentsUl.children.length === 0) {
                  vscode.postMessage({ type: 'getSkillFolderContents', folderName: folderName });
                }
              });
              folderDiv.appendChild(header);
              folderDiv.appendChild(contentsUl);
              var liWrap = document.createElement('li');
              liWrap.className = 'sidebar-skill-folder-li';
              liWrap.style.listStyle = 'none';
              liWrap.appendChild(folderDiv);
              list.appendChild(liWrap);
            });
          } else {
            (files || []).forEach(function(name) {
              var row = document.createElement('li');
              row.className = 'file-row';
              row.setAttribute('data-file', name);
              var nameSpan = document.createElement('span');
              nameSpan.className = 'file-name';
              nameSpan.textContent = name;
              nameSpan.title = name;
              var syncBtn = document.createElement('button');
              syncBtn.className = 'sidebar-sync-btn';
              syncBtn.title = 'Sync to Workspace';
              syncBtn.setAttribute('aria-label', 'Sync to Workspace');
              syncBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.14645 0.646447C7.34171 0.451184 7.65829 0.451184 7.85355 0.646447L9.35355 2.14645C9.54882 2.34171 9.54882 2.65829 9.35355 2.85355L7.85355 4.35355C7.65829 4.54882 7.34171 4.54882 7.14645 4.35355C6.95118 4.15829 6.95118 3.84171 7.14645 3.64645L7.7885 3.00439C5.12517 3.11522 3 5.30943 3 8C3 9.56799 3.72118 10.9672 4.85185 11.8847C5.06627 12.0587 5.09904 12.3736 4.92503 12.588C4.75103 12.8024 4.43615 12.8352 4.22172 12.6612C2.86712 11.5619 2 9.88205 2 8C2 4.75447 4.57689 2.1108 7.79629 2.00339L7.14645 1.35355C6.95118 1.15829 6.95118 0.841709 7.14645 0.646447ZM11.075 3.41199C11.249 3.19756 11.5639 3.1648 11.7783 3.3388C13.1329 4.43806 14 6.11795 14 8C14 11.2455 11.4231 13.8892 8.20371 13.9966L8.85355 14.6464C9.04882 14.8417 9.04882 15.1583 8.85355 15.3536C8.65829 15.5488 8.34171 15.5488 8.14645 15.3536L6.64645 13.8536C6.55268 13.7598 6.5 13.6326 6.5 13.5C6.5 13.3674 6.55268 13.2402 6.64645 13.1464L8.14645 11.6464C8.34171 11.4512 8.65829 11.4512 8.85355 11.6464C9.04882 11.8417 9.04882 12.1583 8.85355 12.3536L8.2115 12.9956C10.8748 12.8848 13 10.6906 13 8C13 6.43201 12.2788 5.03283 11.1482 4.1153C10.9337 3.94129 10.901 3.62641 11.075 3.41199Z"/></svg>';
              if (!window.WORKSPACE_OPEN) { syncBtn.disabled = true; syncBtn.classList.add('sidebar-sync-btn-disabled'); syncBtn.title = 'Sync to Workspace (open a folder first)'; }
              else { syncBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'syncToWorkspace', category: cat, fileName: name }); }); }
              var exportBtn = document.createElement('button');
              exportBtn.className = 'sidebar-export-btn';
              exportBtn.title = 'Export';
              exportBtn.setAttribute('aria-label', 'Export');
              exportBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9 1H2v14h9v-2H4V3h4V1H9zm0 2.4L11.6 5H9V3.4zM11 9l2 2v-2h2v-1h-2V7h-1v2H9v1h2z"/></svg>';
              exportBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'exportItem', category: cat, fileName: name }); });
              var delBtn = document.createElement('button');
              delBtn.className = 'sidebar-delete-btn';
              delBtn.title = 'Delete';
              delBtn.setAttribute('aria-label', 'Delete');
              delBtn.textContent = '\uD83D\uDDD1';
              delBtn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); vscode.postMessage({ type: 'deleteFile', category: cat, fileName: name }); });
              var actionsWrap = document.createElement('span');
              actionsWrap.className = 'sidebar-actions';
              actionsWrap.appendChild(syncBtn);
              actionsWrap.appendChild(exportBtn);
              actionsWrap.appendChild(delBtn);
              nameSpan.addEventListener('click', function() {
                document.querySelectorAll('.sidebar-file-list .file-row').forEach(function(el) { el.classList.remove('active'); });
                document.querySelectorAll('.sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
                row.classList.add('active');
                vscode.postMessage({ type: 'getFileContent', category: cat, fileName: name });
              });
              row.appendChild(nameSpan);
              row.appendChild(actionsWrap);
              list.appendChild(row);
            });
          }
        }
        ['rules', 'skills', 'subagents', 'commands'].forEach(function(category) {
          var list = document.getElementById(category + '-list');
          var section = list && list.closest('.sidebar-section');
          if (!list) return;
          if (section) {
            section.querySelector('.sidebar-section-header').addEventListener('click', function(e) {
              if (e.target.closest('.sidebar-section-help') || e.target.closest('.sidebar-section-import')) return;
              section.classList.toggle('expanded');
            });
            var importBtn = section.querySelector('.sidebar-section-import');
            if (importBtn) {
              importBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({ type: 'importInCategory', category: category });
              });
            }
            var helpLink = section.querySelector('.sidebar-section-help');
            if (helpLink && docUrls[category]) {
              helpLink.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({ type: 'openLink', url: docUrls[category] });
              });
            }
          }
          renderCategoryList(category, fileLists[category] || []);
        });

        var sidebarReadme = document.getElementById('sidebar-readme');
        if (sidebarReadme) {
          sidebarReadme.addEventListener('click', function() {
            document.querySelectorAll('.sidebar-file-list .file-row, .sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
            sidebarReadme.classList.add('active');
            showPlaceholder();
          });
        }
        document.querySelectorAll('.main-placeholder .readme-links a[data-doc]').forEach(function(a) {
          a.addEventListener('click', function(e) {
            e.preventDefault();
            var key = a.getAttribute('data-doc');
            if (docUrls[key]) vscode.postMessage({ type: 'openLink', url: docUrls[key] });
          });
        });

      function showEditor() {
        placeholder.style.display = 'none';
        editorWrap.style.display = 'flex';
        var readmeEl = document.getElementById('sidebar-readme');
        if (readmeEl) readmeEl.classList.remove('active');
      }
      function showPlaceholder() {
        placeholder.style.display = 'block';
        editorWrap.style.display = 'none';
      }

      function loadMonaco(cb) {
        if (monacoLoaded && window.monaco) { cb(); return; }
        var workerUrl = MONACO_CDN + '/vs/base/worker/workerMain.js';
        fetch(workerUrl).then(function(r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function(workerCode) {
          var blob = new Blob([workerCode], { type: 'application/javascript' });
          var blobUrl = URL.createObjectURL(blob);
          window.MonacoEnvironment = { getWorkerUrl: function() { return blobUrl; } };
          var s = document.createElement('script');
          s.src = MONACO_CDN + '/vs/loader.js';
          s.onload = function() {
            require.config({ paths: { vs: MONACO_CDN + '/vs' } });
            require(['vs/editor/editor.main'], function() {
              monacoLoaded = true;
              window.monaco = monaco;
              cb();
            });
          };
          document.head.appendChild(s);
        }).catch(function(err) {
          console.error('Monaco worker fetch failed', err);
          if (editStatus) editStatus.textContent = 'Preview load failed';
        });
      }

      function ensureEditor() {
        if (editor) return;
        var theme = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast') ? 'vs-dark' : 'vs';
        editor = window.monaco.editor.create(editorContainer, {
          value: '',
          language: 'markdown',
          theme: theme,
          readOnly: true,
          minimap: { enabled: false },
          automaticLayout: true,
          fontSize: parseInt(getComputedStyle(document.body).fontSize) || 14,
          fontFamily: getComputedStyle(document.body).fontFamily || 'monospace'
        });
      }

      editBtn.addEventListener('click', function() {
        if (!currentFile) {
          if (editStatus) editStatus.textContent = 'Open a file first';
          return;
        }
        if (editStatus) editStatus.textContent = 'Opening...';
        vscode.postMessage({ type: 'openInEditor', category: currentFile.category, fileName: currentFile.fileName });
      });

      window.addEventListener('message', function(event) {
        var data = event.data;
        if (data.type === 'refreshLists') {
          if (data.fileLists) fileLists = data.fileLists;
          if (typeof data.workspaceOpen === 'boolean') window.WORKSPACE_OPEN = data.workspaceOpen;
          ['rules', 'skills', 'subagents', 'commands'].forEach(function(cat) { renderCategoryList(cat, fileLists[cat] || []); });
          return;
        }
        if (data.type === 'getSkillFolderContentsReply') {
          if (data.error) return;
          var ul = document.querySelector('.sidebar-folder-contents[data-folder="' + data.folderName + '"]');
          if (!ul || ul.children.length > 0) return;
          (data.entries || []).forEach(function(entry) {
            var li = document.createElement('li');
            li.textContent = entry;
            li.title = entry;
            li.setAttribute('data-entry', entry);
            li.addEventListener('click', function() {
              document.querySelectorAll('.sidebar-file-list .file-row').forEach(function(el) { el.classList.remove('active'); });
              document.querySelectorAll('.sidebar-folder-contents li').forEach(function(el) { el.classList.remove('active'); });
              li.classList.add('active');
              vscode.postMessage({ type: 'getFileContent', category: 'skills', fileName: data.folderName + '/' + entry });
            });
            ul.appendChild(li);
          });
          return;
        }
        if (data.type === 'deleteFileReply') {
          if (data.error && editStatus) editStatus.textContent = data.error;
          else if (currentFile && data.deletedCategory === currentFile.category && (currentFile.fileName === data.deletedFileName || (data.deletedCategory === 'skills' && currentFile.fileName.indexOf(data.deletedFileName + '/') === 0))) {
            showPlaceholder();
            currentFile = null;
            if (editStatus) editStatus.textContent = '';
          }
          return;
        }
        if (data.type === 'createNewFileReply') {
          if (data.error) {
            if (editStatus) editStatus.textContent = 'Error: ' + data.error;
          } else {
            if (editStatus) editStatus.textContent = 'Created ' + (data.fileName || '');
            if (data.category && data.fileName) {
              var section = document.querySelector('.sidebar-section[data-category="' + data.category + '"]');
              if (section) section.classList.add('expanded');
              vscode.postMessage({ type: 'getFileContent', category: data.category, fileName: data.fileName });
            }
          }
          return;
        }
        if (data.type === 'openInEditorReply') {
          if (editStatus) editStatus.textContent = data.error ? 'Error: ' + data.error : 'Opened';
          return;
        }
        if (data.type === 'saveFileReply') {
          if (editStatus) editStatus.textContent = data.error ? 'Error: ' + data.error : 'Saved';
          return;
        }
        if (data.type === 'syncReply') {
          if (editStatus) editStatus.textContent = data.error ? 'Error: ' + data.error : (data.cancelled ? '' : 'Synced to workspace');
          if (data.error) setTimeout(function() { if (editStatus) editStatus.textContent = ''; }, 4000);
          return;
        }
        if (data.type === 'getFileContentReply') {
          if (data.error) {
            if (editStatus) editStatus.textContent = data.error;
            return;
          }
          loadMonaco(function() {
            ensureEditor();
            currentFile = { category: data.category || 'rules', fileName: data.fileName || '' };
            if (data.ruleFrontmatter) {
              isRuleEditor = true;
              ruleBody = data.body != null ? data.body : '';
              if (ruleControls) ruleControls.classList.add('visible');
              var rf = data.ruleFrontmatter;
              if (ruleTypeSelect) {
                if (rf.alwaysApply === true) ruleTypeSelect.value = 'always';
                else if ((rf.description || '').trim()) ruleTypeSelect.value = 'intelligent';
                else if ((rf.globs || '').trim()) ruleTypeSelect.value = 'files';
                else ruleTypeSelect.value = 'manual';
              }
              if (ruleExtraInput) {
                var rfDesc = (rf.description || '').trim();
                var rfGlobs = (rf.globs || '').trim();
                ruleExtraInput.value = ruleTypeSelect && ruleTypeSelect.value === 'files' ? rfGlobs : rfDesc;
              }
              updateRuleTypeUI();
              editor.updateOptions({ readOnly: true });
              updateRulePreview();
            } else {
              isRuleEditor = false;
              if (ruleControls) ruleControls.classList.remove('visible');
              editor.setValue(data.content || '');
              editor.updateOptions({ readOnly: true });
            }
            showEditor();
            if (editStatus) editStatus.textContent = '';
          });
        }
      });
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    })();
  <\/script>
</body>
</html>`;
}
