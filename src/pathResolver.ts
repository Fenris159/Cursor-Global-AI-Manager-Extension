import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";

/**
 * Returns the absolute path to the global .cursor directory.
 *
 * Uses os.homedir() so it adapts to:
 * - Custom drive letters
 * - Domain-mapped / redirected user profiles
 * - Enterprise setups, WSL, SSH, remote
 *
 * Optional: setting `cursorGlobalAI.globalCursorPath` overrides this (e.g. portable install).
 * - Relative paths are resolved against the user's home directory (portable across OS and workspace).
 * - Absolute paths are used as-is.
 */
export function getGlobalCursorDir(context: vscode.ExtensionContext): string {
  const config = vscode.workspace.getConfiguration("cursorGlobalAI");
  const customPath = config.get<string>("globalCursorPath");
  if (customPath && customPath.trim().length > 0) {
    const trimmed = customPath.trim();
    if (path.isAbsolute(trimmed)) {
      return path.normalize(trimmed);
    }
    return path.join(os.homedir(), path.normalize(trimmed));
  }
  return path.join(os.homedir(), ".cursor");
}

/**
 * Returns the absolute path to the backups directory: ~/.cursor/.backups/
 * Respects cursorGlobalAI.globalCursorPath when set.
 */
export function getBackupDir(context: vscode.ExtensionContext): string {
  return path.join(getGlobalCursorDir(context), ".backups");
}
