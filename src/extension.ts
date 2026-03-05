import * as fs from "fs";
import type { FSWatcher } from "fs";
import * as vscode from "vscode";
import type { Category } from "./fsManager";

let statusBarItem: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  try {
    outputChannel = vscode.window.createOutputChannel("Cursor Global AI Manager");
    context.subscriptions.push({
      dispose() {
        outputChannel?.dispose();
        outputChannel = undefined;
      },
    });
    const openManagerCommand = vscode.commands.registerCommand(
      "cursorGlobalAI.openManager",
      async () => {
        try {
          await openManagerPanel(context);
        } catch (err) {
          void vscode.window.showErrorMessage(
            "Manage User AI could not open. Check Help > Toggle Developer Tools > Console for details."
          );
        }
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

const LOADING_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Manage User AI</title></head>
<body style="margin:0;padding:1.5rem;font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);">
  <p>Loading Manage User AI…</p>
</body></html>`;

async function openManagerPanel(context: vscode.ExtensionContext): Promise<void> {
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
  panel.webview.html = LOADING_HTML;

  void (async function populatePanel() {
    try {
  const path = await import("path");
  const fs = await import("fs");
  const { getGlobalCursorDir } = await import("./pathResolver");
  const {
    createFileWithTemplate,
    deleteInCategory,
    ensureGlobalCursorDirs,
    clearHooksConfig,
    createHookScript,
    ensureDefaultHookPlaceholders,
    ensureHooksConfigExists,
    exportFileToPath,
    exportSkillFolderToPath,
    getFilePathForCategory,
    getHooksData,
    importFileIntoCategory,
    importFileIntoHooks,
    setHookScriptEnabled,
    spawnAbsentHookPlaceholders,
    syncToWorkspace,
    importSkillFolder,
    importSkillFromFile,
    listFilesInCategory,
    listSkillFolderContents,
    parseRuleContentForPreview,
    readFileContent,
    writeFileContent,
  } = await import("./fsManager");

  let lastViewedFile: { category: Category; fileName: string } | null = null;
  /** True after requestHooksData has been handled; used to avoid fetching hooks in refreshPanelLists until Hooks section is used. */
  let hooksDataRequestedThisSession = false;
  /** Set when panel is disposed; guards postMessage after async work. */
  let panelDisposed = false;
  /** Cache parsed file content per (category, fileName) to avoid re-reading/re-parsing. Invalidated on save and when a file is removed from list. */
  type CachedEntry = { content: string; ruleFrontmatter?: { description: string; alwaysApply: boolean; globs: string }; body?: string };
  const parsedCache = new Map<string, CachedEntry>();

  const initialHooksData: { configFile: string; scripts: string[]; enabledScripts: string[] } = {
    configFile: "hooks.json",
    scripts: [],
    enabledScripts: [],
  };

  function parsedCacheKey(category: Category, fileName: string): string {
    return `${category}:${fileName}`;
  }

  function invalidateParsedCache(category?: Category, fileName?: string): void {
    if (category != null && fileName != null) parsedCache.delete(parsedCacheKey(category, fileName));
    else parsedCache.clear();
  }

  /** Remove cache entries only for files no longer in the current lists (keeps cache for unchanged files). */
  function invalidateParsedCacheForRemovedFiles(
    rulesFiles: string[],
    skillsFiles: string[],
    subagentsFiles: string[],
    commandsFiles: string[],
    hooksData: { configFile: string; scripts: string[] }
  ): void {
    const rulesSet = new Set(rulesFiles);
    const skillsSet = new Set(skillsFiles);
    const subagentsSet = new Set(subagentsFiles);
    const commandsSet = new Set(commandsFiles);
    const hooksSet = new Set([hooksData.configFile, ...hooksData.scripts]);
    for (const key of Array.from(parsedCache.keys())) {
      const colon = key.indexOf(":");
      if (colon <= 0) continue;
      const category = key.slice(0, colon) as Category;
      const fileName = key.slice(colon + 1);
      const inList =
        category === "rules" ? rulesSet.has(fileName) :
        category === "skills" ? skillsSet.has(fileName) :
        category === "subagents" ? subagentsSet.has(fileName) :
        category === "commands" ? commandsSet.has(fileName) :
        category === "hooks" ? hooksSet.has(fileName) :
        false;
      if (!inList) parsedCache.delete(key);
    }
  }

  function safePostMessage(msg: unknown): void {
    if (panelDisposed) return;
    try {
      panel.webview.postMessage(msg);
    } catch (_) {
      // panel disposed or webview closed
    }
  }

  /** Validates msg.category and msg.fileName; sends error reply and returns false if invalid. */
  function validateCategoryAndFile(
    msg: { category?: string; fileName?: string },
    replyType: string
  ): msg is { category: Category; fileName: string } {
    if (!msg.category || !msg.fileName) return false;
    if (!isValidCategory(msg.category) || !isSafeFilePathForCategory(msg.category, msg.fileName)) {
      safePostMessage({ type: replyType, error: "Invalid request" });
      return false;
    }
    return true;
  }

  function errorMessage(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
  }

  function postFileContentReply(
    cached: CachedEntry,
    category: Category,
    fileName: string
  ): void {
    if (cached.ruleFrontmatter) {
      safePostMessage({
        type: "getFileContentReply",
        content: cached.content,
        body: cached.body,
        ruleFrontmatter: cached.ruleFrontmatter,
        category,
        fileName,
      });
    } else {
      safePostMessage({
        type: "getFileContentReply",
        content: cached.content,
        category,
        fileName,
      });
    }
  }

  async function refreshPanelLists(): Promise<void> {
    const listPromise = Promise.all([
      listFilesInCategory(context, "rules"),
      listFilesInCategory(context, "skills"),
      listFilesInCategory(context, "subagents"),
      listFilesInCategory(context, "commands"),
    ]);
    const hooksPromise = hooksDataRequestedThisSession ? getHooksData(context) : Promise.resolve(initialHooksData);
    const [[rulesFiles, skillsFiles, subagentsFiles, commandsFiles], hooksData] = await Promise.all([
      listPromise,
      hooksPromise,
    ]);
    invalidateParsedCacheForRemovedFiles(rulesFiles, skillsFiles, subagentsFiles, commandsFiles, hooksData);
    safePostMessage({
      type: "refreshLists",
      fileLists: { rules: rulesFiles, skills: skillsFiles, subagents: subagentsFiles, commands: commandsFiles },
      hooksData,
      workspaceOpen: !!(vscode.workspace.workspaceFolders?.length),
    });
  }

  let viewStateDisposable: vscode.Disposable | undefined;
  viewStateDisposable = panel.onDidChangeViewState(
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
        postFileContentReply(cached, lastViewedFile.category, lastViewedFile.fileName);
      } catch (_) {
        // ignore; preview stays as-is
      }
    },
    null
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

  const mediaDir = path.join(context.extensionUri.fsPath, "media");
  const overviewHtml = loadEmbeddedHtml(path.join(mediaDir, "overview.html"));
  const hooksLandingHtml = loadEmbeddedHtml(path.join(mediaDir, "hooks-landing.html"));

  const managerScriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "manager.js")
  );
  panel.webview.html = getMinimalHtml(
    toolkitUri.toString(),
    managerScriptUri.toString(),
    panel.webview.cspSource,
    rulesFiles,
    skillsFiles,
    subagentsFiles,
    commandsFiles,
    !!(vscode.workspace.workspaceFolders?.length),
    initialHooksData,
    overviewHtml,
    hooksLandingHtml
  );

  panel.webview.onDidReceiveMessage(
    async (msg: {
      type: string;
      category?: Category;
      fileName?: string;
      content?: string;
      url?: string;
      folderName?: string;
      scriptName?: string;
      enabled?: boolean;
      baseName?: string;
    }) => {
      if (msg.type === "openLink" && typeof msg.url === "string" && msg.url.startsWith("https://")) {
        try {
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        } catch (_) {}
        return;
      }
      if (msg.type === "createNewFile" && msg.category && isValidCategory(msg.category)) {
        if (msg.category === "hooks") return;
        const placeholders: Record<string, string> = {
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
          safePostMessage({ type: "createNewFileReply", category: msg.category, fileName: created });
        } catch (err) {
          safePostMessage({
            type: "createNewFileReply",
            error: errorMessage(err, "Failed to create file"),
          });
        }
        return;
      }
      if (msg.type === "getFileContent" && msg.category && msg.fileName) {
        if (!validateCategoryAndFile(msg, "getFileContentReply")) return;
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
          postFileContentReply(cached, msg.category, msg.fileName);
        } catch (err) {
          safePostMessage({
            type: "getFileContentReply",
            error: errorMessage(err, "Read failed"),
          });
        }
      } else if (msg.type === "saveFile" && msg.category && msg.fileName && typeof msg.content === "string") {
        if (!validateCategoryAndFile(msg, "saveFileReply")) return;
        try {
          await writeFileContent(context, msg.category, msg.fileName, msg.content);
          invalidateParsedCache(msg.category, msg.fileName);
          safePostMessage({ type: "saveFileReply" });
        } catch (err) {
          const errMsg = errorMessage(err, "Save failed");
          safePostMessage({ type: "saveFileReply", error: errMsg });
        }
      } else if (msg.type === "getSkillFolderContents" && typeof msg.folderName === "string") {
        if (!isSafeFileName(msg.folderName)) {
          safePostMessage({ type: "getSkillFolderContentsReply", error: "Invalid folder name" });
          return;
        }
        try {
          const entries = await listSkillFolderContents(context, msg.folderName);
          safePostMessage({
            type: "getSkillFolderContentsReply",
            folderName: msg.folderName,
            entries,
          });
        } catch (err) {
          safePostMessage({
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
              safePostMessage({ type: "importReply", cancelled: true });
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
                safePostMessage({ type: "importReply", cancelled: true });
                return;
              }
              const folderName = await importSkillFolder(context, uris[0].fsPath);
              await refreshPanelLists();
              safePostMessage({ type: "importReply", category: "skills", fileName: `${folderName}/SKILL.md` });
            } else {
              const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                title: "Select SKILL.md (or similar) file",
                filters: { "Markdown / text": ["md", "mdc", "txt"], "All files": ["*"] },
              });
              if (!uris?.length) {
                safePostMessage({ type: "importReply", cancelled: true });
                return;
              }
              const fileName = await importSkillFromFile(context, uris[0].fsPath);
              await refreshPanelLists();
              safePostMessage({ type: "importReply", category: "skills", fileName });
            }
          } else if (msg.category === "hooks") {
            const uris = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: false,
              title: "Import hook script into Hooks",
              filters: { "Text / Scripts": ["sh", "js", "ts", "txt", "md", "mdc", "bash", "zsh"], "All files": ["*"] },
            });
            if (!uris?.length) {
              safePostMessage({ type: "importReply", cancelled: true });
              return;
            }
            const fileName = await importFileIntoHooks(context, uris[0].fsPath);
            await refreshPanelLists();
            safePostMessage({ type: "importReply", category: "hooks", fileName });
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
              safePostMessage({ type: "importReply", cancelled: true });
              return;
            }
            const fileName = await importFileIntoCategory(context, msg.category, uris[0].fsPath);
            await refreshPanelLists();
            safePostMessage({ type: "importReply", category: msg.category, fileName });
          }
        } catch (err) {
          safePostMessage({
            type: "importReply",
            error: errorMessage(err, "Import failed"),
          });
        }
      } else if (msg.type === "deleteFile" && msg.category && msg.fileName) {
        if (!validateCategoryAndFile(msg, "deleteFileReply")) return;
        const label =
          msg.category === "skills"
            ? `skill "${msg.fileName}"`
            : msg.category === "hooks" && msg.fileName === "hooks.json"
              ? "hooks configuration (clear all hooks)"
              : msg.category === "hooks"
                ? `hook script "${msg.fileName}"`
                : `file "${msg.fileName}"`;
        const confirm = await vscode.window.showWarningMessage(
          `Delete ${label}? This cannot be undone.`,
          "Delete",
          "Cancel"
        );
        if (confirm !== "Delete") {
          safePostMessage({ type: "deleteFileReply", cancelled: true });
          return;
        }
        try {
          await deleteInCategory(context, msg.category, msg.fileName);
          await refreshPanelLists();
          safePostMessage({
            type: "deleteFileReply",
            deletedCategory: msg.category,
            deletedFileName: msg.fileName,
          });
        } catch (err) {
          safePostMessage({
            type: "deleteFileReply",
            error: errorMessage(err, "Delete failed"),
          });
        }
      } else if (msg.type === "exportItem" && msg.category && msg.fileName) {
        if (!validateCategoryAndFile(msg, "exportReply")) return;
        try {
          if (msg.category === "skills") {
            const folderName = msg.fileName.indexOf("/") >= 0 ? msg.fileName.split("/")[0] : msg.fileName;
            if (!isSafeFileName(folderName)) {
              safePostMessage({ type: "exportReply", error: "Invalid folder name" });
              return;
            }
            const uris = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              title: "Select folder to export skill into",
            });
            if (!uris?.length) {
              safePostMessage({ type: "exportReply", cancelled: true });
              return;
            }
            await exportSkillFolderToPath(context, msg.fileName, uris[0].fsPath);
          } else {
            const defaultUri = vscode.Uri.joinPath(context.globalStorageUri, msg.fileName);
            const uri = await vscode.window.showSaveDialog({
              defaultUri,
              title: "Export file",
            });
            if (!uri) {
              safePostMessage({ type: "exportReply", cancelled: true });
              return;
            }
            await exportFileToPath(context, msg.category, msg.fileName, uri.fsPath);
          }
          safePostMessage({ type: "exportReply", category: msg.category, fileName: msg.fileName });
        } catch (err) {
          safePostMessage({
            type: "exportReply",
            error: errorMessage(err, "Export failed"),
          });
        }
      } else if (msg.type === "syncToWorkspace" && msg.category && msg.fileName) {
        if (!validateCategoryAndFile(msg, "syncReply")) return;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          safePostMessage({
            type: "syncReply",
            error: "Open a workspace folder first (File → Open Folder).",
          });
          return;
        }
        try {
          if (msg.category === "skills") {
            const folderName = msg.fileName.indexOf("/") >= 0 ? msg.fileName.split("/")[0] : msg.fileName;
            if (!isSafeFileName(folderName)) {
              safePostMessage({ type: "syncReply", error: "Invalid folder name" });
              return;
            }
            await syncToWorkspace(context, workspaceFolder.uri.fsPath, "skills", folderName);
          } else {
            await syncToWorkspace(context, workspaceFolder.uri.fsPath, msg.category, msg.fileName);
          }
          safePostMessage({ type: "syncReply", category: msg.category, fileName: msg.fileName });
        } catch (err) {
          safePostMessage({
            type: "syncReply",
            error: errorMessage(err, "Sync failed"),
          });
        }
      } else if (msg.type === "requestHooksData") {
        try {
          hooksDataRequestedThisSession = true;
          const hooksPlaceholdersInitialized = context.globalState.get<boolean>("hooksPlaceholdersInitialized");
          if (!hooksPlaceholdersInitialized) {
            await ensureHooksConfigExists(context);
            await ensureDefaultHookPlaceholders(context);
            await context.globalState.update("hooksPlaceholdersInitialized", true);
          }
          const hooksData = await getHooksData(context);
          safePostMessage({ type: "hooksData", hooksData });
        } catch (err) {
          safePostMessage({
            type: "hooksDataError",
            error: errorMessage(err, "Failed to load hooks"),
          });
        }
      } else if (msg.type === "setHookEnabled" && typeof msg.scriptName === "string" && typeof msg.enabled === "boolean") {
        if (!isSafeFilePathForCategory("hooks", msg.scriptName)) {
          safePostMessage({ type: "hooksDataError", error: "Invalid script name" });
          return;
        }
        try {
          await setHookScriptEnabled(context, msg.scriptName, msg.enabled);
          const hooksData = await getHooksData(context);
          invalidateParsedCache("hooks", hooksData.configFile || "hooks.json");
          safePostMessage({ type: "hooksData", hooksData });
          safePostMessage({
            type: "showFileInPreview",
            category: "hooks",
            fileName: hooksData.configFile || "hooks.json",
          });
        } catch (err) {
          safePostMessage({
            type: "hooksDataError",
            error: errorMessage(err, "Failed to update hook"),
          });
        }
      } else if (msg.type === "createNewHook") {
        let baseName: string | undefined = typeof msg.baseName === "string" ? msg.baseName.trim() : undefined;
        if (baseName === undefined || baseName === "") {
          const entered = await vscode.window.showInputBox({
            title: "New hook script",
            prompt: "Enter a name for the hook script (e.g. my-hook or format). A .sh file will be created in ~/.cursor/hooks/.",
            value: "my-hook",
            validateInput: (value) => {
              const trimmed = value.trim();
              if (!trimmed) return "Name is required.";
              if (/[<>:"/\\|?*]/.test(trimmed)) return "Name cannot contain \\ / : * ? \" < > |";
              return null;
            },
          });
          if (entered === undefined) {
            safePostMessage({ type: "createNewHookReply", error: "Canceled" });
            return;
          }
          baseName = entered.trim();
        }
        try {
          hooksDataRequestedThisSession = true;
          const scriptName = await createHookScript(context, baseName);
          const hooksData = await getHooksData(context);
          safePostMessage({ type: "createNewHookReply", scriptName });
          safePostMessage({ type: "hooksData", hooksData });
          await refreshPanelLists();
        } catch (err) {
          safePostMessage({
            type: "createNewHookReply",
            error: errorMessage(err, "Failed to create hook script"),
          });
        }
      } else if (msg.type === "spawnHookPlaceholders") {
        try {
          hooksDataRequestedThisSession = true;
          await spawnAbsentHookPlaceholders(context);
          const hooksData = await getHooksData(context);
          safePostMessage({ type: "hooksData", hooksData });
          await refreshPanelLists();
        } catch (err) {
          safePostMessage({
            type: "hooksDataError",
            error: errorMessage(err, "Failed to create placeholder hooks"),
          });
        }
      } else if (msg.type === "openInEditor" && msg.category && msg.fileName) {
        if (!validateCategoryAndFile(msg, "openInEditorReply")) return;
        const filePath = getFilePathForCategory(context, msg.category, msg.fileName);
        const uri = vscode.Uri.file(filePath);
        try {
          await vscode.commands.executeCommand("vscode.open", uri, {
            viewColumn: vscode.ViewColumn.One,
            preview: false,
          });
          safePostMessage({ type: "openInEditorReply" });
        } catch (err) {
          const raw = errorMessage(err, String(err));
          const is50Mb = raw.includes("50MB") || raw.includes("50 MB");
          const message = is50Mb
            ? "File outside workspace: add your .cursor folder to the workspace to edit here, or open the file from File Explorer."
            : "Could not open file.";
          safePostMessage({
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
            invalidateParsedCache();
            await refreshPanelLists();
          } catch (_) {
            // ignore (e.g. panel disposed)
          }
        }, DEBOUNCE_MS);
      }
    );
  } catch (err) {
    outputChannel?.appendLine(
      "File watcher could not be started. List auto-refresh when files change outside the extension is disabled. Lists still work; use Refresh or reopen the panel to update."
    );
  }
  panel.onDidDispose(() => {
    panelDisposed = true;
    viewStateDisposable?.dispose();
    if (watcher) watcher.close();
    if (watchTimeout) clearTimeout(watchTimeout);
  });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const escaped = msg.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="padding:1.5rem;font-family:var(--vscode-font-family);"><p>Failed to load: ${escaped}</p></body></html>`;
    }
  })();
}

const VALID_CATEGORIES: Category[] = ["rules", "skills", "subagents", "commands", "hooks"];

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

/** For skills, fileName can be a path like "folder/scripts/file.py". For hooks: hooks.json or script name. */
function isSafeFilePathForCategory(category: Category, fileName: string): boolean {
  if (fileName.length === 0 || fileName.includes("..") || fileName.includes("\\")) return false;
  if (category === "skills") return true; // allow "/" for paths within skill folder
  if (category === "hooks") return fileName === "hooks.json" || /^[a-zA-Z0-9_.-]+\.(sh|js|ts)$/.test(fileName);
  return !fileName.includes("/");
}

const DOC_URLS: Record<Category, string> = {
  rules: "https://cursor.com/docs/context/rules",
  skills: "https://cursor.com/docs/context/skills",
  subagents: "https://cursor.com/docs/context/subagents",
  commands: "https://cursor.com/docs/context/commands",
  hooks: "https://cursor.com/docs/agent/hooks",
};

/** Reads an HTML fragment from the extension's media folder and escapes it for embedding in a template literal. */
function loadEmbeddedHtml(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$\{/g, "\\${")
      .replace(/<\/script/gi, "<\\/script");
  } catch {
    return "";
  }
}

function getMinimalHtml(
  toolkitScriptSrc: string,
  managerScriptSrc: string,
  cspSource: string,
  rulesFiles: string[],
  skillsFiles: string[],
  subagentsFiles: string[],
  commandsFiles: string[],
  workspaceOpen: boolean,
  hooksData: { configFile: string; scripts: string[]; enabledScripts: string[] },
  overviewHtml: string,
  hooksLandingHtml: string
): string {
  const scriptSrc = toolkitScriptSrc.replace(/"/g, "&quot;");
  const managerScriptSrcEscaped = managerScriptSrc.replace(/"/g, "&quot;");
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
  const hooksDataJson = JSON.stringify(hooksData).replace(/<\//g, "<\\/");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${csp} https://cdn.jsdelivr.net; style-src 'unsafe-inline' ${csp} https://cdn.jsdelivr.net; font-src ${csp} https://cdn.jsdelivr.net; connect-src ${csp} https://cdn.jsdelivr.net; worker-src blob:;">
  <title>Manage User AI</title>
  <script src="${scriptSrc}"><\/script>
  <script>
    window.FILE_LISTS = ${fileListsJson};
    window.DOC_URLS = ${docUrlsJson};
    window.WORKSPACE_OPEN = ${workspaceOpenJson};
    window.HOOKS_DATA = ${hooksDataJson};
  <\/script>
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
  <script src="${managerScriptSrcEscaped}"><\/script>
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
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground);
      border-right: 1px solid var(--vscode-sideBar-border);
      padding: 0.5rem 0;
    }
    .sidebar-contents { flex: 1; min-height: 0; overflow-y: auto; }
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
    .sidebar-section-header.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
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
      max-height: 5000px;
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
    .sidebar-file-list .file-row.active, .sidebar-folder-header.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
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
    .sidebar-skill-folder.expanded .sidebar-folder-contents { max-height: 5000px; }
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
    .sidebar-hook-script-row { display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.5rem 0.25rem 1rem; font-size: 0.8rem; cursor: pointer; }
    .sidebar-hook-script-row .sidebar-hook-checkbox { flex-shrink: 0; margin: 0; }
    .sidebar-hook-script-row .sidebar-hook-script-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sidebar-hook-script-row .sidebar-actions { margin-left: auto; }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-contents">
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
      <div class="sidebar-section" data-category="hooks">
        <div class="sidebar-section-header" title="Expand or collapse">
          <span class="sidebar-section-chevron" aria-hidden="true"></span>
          <span class="sidebar-section-title">#HOOKS CONFIGURATION</span>
          <button type="button" class="sidebar-section-import" title="Import script into Hooks" aria-label="Import into Hooks" data-category="hooks"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-8L14.5 3zm-.51 8.5h-12v-7h4.29l.85.85.35.15H14v6z"/></svg></button>
          <a class="sidebar-section-help" href="#" title="Learn about Hooks" data-url="hooks" aria-label="Learn about Hooks">?</a>
        </div>
        <ul class="sidebar-file-list" id="hooks-list"></ul>
      </div>
      </div>
    </aside>
    <main class="main">
      <div class="main-placeholder" id="main-placeholder">
        <div id="readme-content">${overviewHtml}</div>
        <div id="hooks-landing" style="display: none;">${hooksLandingHtml}</div>
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

</body>
</html>`;
}
