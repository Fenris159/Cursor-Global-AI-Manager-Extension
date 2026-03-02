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
 */
export function getGlobalCursorDir(context: vscode.ExtensionContext): string {
  const config = vscode.workspace.getConfiguration("cursorGlobalAI");
  const customPath = config.get<string>("globalCursorPath");
  if (customPath && customPath.trim().length > 0) {
    return path.resolve(customPath.trim());
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
