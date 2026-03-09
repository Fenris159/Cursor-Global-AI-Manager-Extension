<img src="images/robot-manager512.png" alt="Cursor Global AI Manager" width="80" height="80" /> <h1>Cursor Global AI Manager</h1>

> **Manage user-level rules, skills, subagents, commands, and hooks in one place.**  
> Open the panel from the status bar (**Manage User AI**) or the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P` → **Manage User AI**) to browse, preview, and edit everything in `~/.cursor/` without leaving Cursor.

**User-level** means these settings apply to *every* Cursor workspace you open, not just the current project.

> **Changes don’t apply to existing chats.** Start a **new chat** or right‑click the agent in the sidebar and choose **Fork chat** to pick up the new settings.

---

## Install from VSIX

If you have a built `.vsix` (e.g. from [Releases](https://github.com/Fenris159/Cursor-Global-AI-Manager-Extension/releases) or from building locally):

1. In Cursor: **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Extensions: Install from VSIX...**
2. Select the downloaded `.vsix` file (e.g. from the current release or from the project’s `.vsce/` folder).
3. Reload the window if prompted.

---

## Global impact

> **Changes you make here apply to every Cursor workspace** (every project and folder). Add or edit content only when you intend it to affect all projects. Consider testing in a single project first if unsure.

---

## Rules format

In Cursor’s **Settings → Rules**, a rule with only `alwaysApply: false` and no `description` or `globs` may show **"Incorrect format"**. That’s expected: when a rule isn’t always applied, Cursor needs either a **description** (Apply Intelligently) or **globs** (Apply to Specific Files). Without either, the rule only applies when you **@mention it** (Apply Manually).

### User rules and the “User” tab

Rules you manage in this extension live in `~/.cursor/rules/` (file-based). They may **not** show under the **User** filter in Cursor’s **Settings → Rules**; Cursor’s “User” tab often shows only rules stored in its internal state (e.g. cloud or local DB). Your file-based rules **still apply globally** and will appear under **All** (and in project-level filters). They are loaded and used by the AI—this is a display quirk, not a loading issue.

---

## Hooks

**Hooks** let you run custom scripts when the agent does certain things—for example when a session starts, before or after the agent edits a file, runs a shell command, or uses an MCP tool. This extension manages:

- **`~/.cursor/hooks.json`** — Config that defines which scripts run at each event. Select it in the Hooks section to view or edit; use the trash icon to clear all hooks.
- **`~/.cursor/hooks/`** — Your hook script files (e.g. `after-file-edit.sh`, `before-shell-execution.js`). Script names map to events (kebab-case: `after-file-edit.sh` → `afterFileEdit`). Supported extensions: `.sh`, `.js`, `.ts`.

**First run:** The first time you expand Hooks after installing, the extension creates empty `hooks.json` and 20 default stub scripts in `~/.cursor/hooks/` if they're missing. None are enabled until you check the box. Use **Spawn placeholders** (under + Create new in the hooks folder) to restore any missing default script files later.

**Enable a script:** Check the box next to the script; it's registered for that event in `hooks.json` and runs automatically when the agent triggers the event. No restart needed.

Full list of events, script contract (stdin JSON, exit 0/2), and Windows/Node notes are in the **Hooks** landing page inside the panel (click Hooks in the sidebar, then read the main area when no script is selected).

---

## How to use

1. **Expand** a category in the sidebar (Rules, Skills, Subagents, Commands, or Hooks).
2. **Select** a file (or for Hooks, `hooks.json` or a script) to preview it.
3. Use **Edit** to open the file in the editor so the AI can help you change it.
4. Use **+ Create new** to add a new rule, skill, subagent, command, or hook script.
5. For a **skill folder**, use the pencil icon to open that skill in a new window and edit it as a whole.
6. Use **Import** (folder icon in the category header) to add files or skill folders from disk into that category (or hook scripts into Hooks).
7. Use **Export** (document-with-arrow icon on each file or skill folder) to save a copy to a location you choose.
8. Use **Sync to Workspace** (sync icon) to copy the selected global file or skill folder into this project’s `.cursor` folder so you can share it with the team.

Use the **?** button next to each category name in the sidebar to open Cursor’s official docs for that feature. The overview (#README) and Hooks landing page in the panel have detailed in-app documentation.

### What each category is

|   | Category   | What it is |
|---|-----------|------------|
| 📋 | **Rules** | Global rules that guide the AI (e.g. coding style, project conventions). |
| 🧠 | **Skills** | Agent skills (reusable capabilities); each skill is a folder with a `SKILL.md`. |
| 🤖 | **Subagents** | Custom agent configurations (e.g. specialized subagents for different tasks). Stored in `~/.cursor/agents/` (Cursor’s folder name). |
| ⚡ | **Commands** | Custom slash commands you can run from chat. |
| 🪝 | **Hooks** | Scripts that run when the agent does certain things (e.g. after editing a file, before running a shell command). Managed via `~/.cursor/hooks.json` and `~/.cursor/hooks/`. |

### Import

- **Rules, Subagents, Commands:** Click the folder icon in the category header and pick a file. It is copied into `~/.cursor/rules/`, `~/.cursor/agents/`, or `~/.cursor/commands/` (subagents use the `agents` folder; rules are normalized to `.mdc` with valid frontmatter).
- **Skills:** Choose to import a whole folder (copied as a skill folder) or a single `SKILL.md` file (a new skill folder is created from it).
- **Hooks:** Import adds script files into `~/.cursor/hooks/`. Enable a script with its checkbox to register it for that event in `hooks.json`.

### Export

- **File (Rules, Subagents, Commands):** Click the export icon on a file row and choose where to save the file.
- **Skill folder:** Click the export icon on a skill folder and choose a parent folder; the skill is copied there as `<folderName>/`.
- **Hooks:** Export copies `hooks.json` or a hook script file to the location you choose.

### Sync to Workspace

- Copies the selected global file or skill folder (or hook script) into the **current workspace’s** `.cursor` folder (e.g. `workspace/.cursor/rules/my-rule.mdc`, `workspace/.cursor/agents/my-agent.md`, `workspace/.cursor/skills/my-skill/`, or `workspace/.cursor/hooks/after-file-edit.sh`). Subagents sync to `workspace/.cursor/agents/`. Creates the `.cursor` and category folder if they don’t exist.
- Useful when you want to move a global rule, skill, subagent, command, or hook into the project so other developers can use it. Requires a folder to be open (File → Open Folder).

### Backups

- Before any **overwrite** (Save, Import, or Create new with an existing name), the extension copies the current file or skill folder to `~/.cursor/.backups/` with a timestamped name (e.g. `20250302T143045-rules-my-rule.mdc` or `20250302T143045-skills-my-skill/`). For Hooks, backups go to `~/.cursor/Hooks_Backup/` (last 5 per file). Restore by copying a backup back into the matching location under `~/.cursor/`.

---

**Versioning:** The extension version is in `package.json`. Release history is in [CHANGELOG.md](CHANGELOG.md) (semantic versioning).

**Docs:** Use the **?** buttons in the panel to open Cursor’s docs (Rules, Skills, Subagents, Commands, Hooks). Overview and [Cursor Docs](https://cursor.com/docs) cover rules, skills, subagents, commands, and [agent hooks](https://cursor.com/docs/agent/hooks).
