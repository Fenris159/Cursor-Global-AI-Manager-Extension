# Cursor Global AI Manager

> **Manage user-level rules, skills, subagents, and commands in one place.**  
> Open the panel from the status bar (**Manage User AI**) or the Command Palette to browse, preview, and edit everything in `~/.cursor/` without leaving Cursor.

> **Changes don’t apply to existing chats.** Start a **new chat** or right‑click the agent in the sidebar and choose **Fork chat** to pick up the new settings.

---

## Global impact

> **Changes you make here apply to every Cursor workspace** (every project and folder). Add or edit content only when you intend it to affect all projects. Consider testing in a single project first if unsure.

---

## Rules format

In Cursor’s **Settings → Rules**, a rule with only `alwaysApply: false` and no `description` or `globs` may show **"Incorrect format"**. That’s expected: when a rule isn’t always applied, Cursor needs either a **description** (Apply Intelligently) or **globs** (Apply to Specific Files). Without either, the rule only applies when you **@mention it** (Apply Manually).

### User rules and the “User” tab

Rules you manage in this extension live in `~/.cursor/rules/` (file-based). They may **not** show under the **User** filter in Cursor’s **Settings → Rules**; Cursor’s “User” tab often shows only rules stored in its internal state (e.g. cloud or local DB). Your file-based rules **still apply globally** and will appear under **All** (and in project-level filters). They are loaded and used by the AI—this is a display quirk, not a loading issue.

---

## How to use

1. **Expand** a category in the sidebar (Rules, Skills, Subagents, Commands).
2. **Select** a file to preview it.
3. Use **Edit** to open the file in the editor so the AI can help you change it.
4. Use **+ Create new** to add a new rule, skill, subagent, or command.
5. For a **skill folder**, use the pencil icon to open that skill in a new window and edit it as a whole.
6. Use **Import** (folder icon in the category header) to add files or skill folders from disk into that category.
7. Use **Export** (document-with-arrow icon on each file or skill folder) to save a copy to a location you choose.
8. Use **Sync to Workspace** (sync icon) to copy the selected global file or skill folder into this project’s `.cursor` folder so you can share it with the team.

### Import

- **Rules, Subagents, Commands:** Click the folder icon in the category header and pick a file. It is copied into `~/.cursor/<category>/` (rules are normalized to `.mdc` with valid frontmatter).
- **Skills:** Choose to import a whole folder (copied as a skill folder) or a single `SKILL.md` file (a new skill folder is created from it).

### Export

- **File (Rules, Subagents, Commands):** Click the export icon on a file row and choose where to save the file.
- **Skill folder:** Click the export icon on a skill folder and choose a parent folder; the skill is copied there as `<folderName>/`.

### Sync to Workspace

- Copies the selected global file or skill folder into the **current workspace’s** `.cursor` folder under the same category (e.g. `workspace/.cursor/rules/my-rule.mdc` or `workspace/.cursor/skills/my-skill/`). Creates the `.cursor` and category folder if they don’t exist.
- Useful when you want to move a global rule, skill, subagent, or command into the project so other developers (who don’t have it in their user `~/.cursor/`) can use it. Requires a folder to be open (File → Open Folder).

### Backups

- Before any **overwrite** (Save, Import, or Create new with an existing name), the extension copies the current file or skill folder to `~/.cursor/.backups/` with a timestamped name (e.g. `20250302T143045-rules-my-rule.mdc` or `20250302T143045-skills-my-skill/`). You can restore by copying a backup back into the matching category folder.

### What each category is

|   | Category   | What it is |
|---|-----------|------------|
| 📋 | **Rules** | Global rules that guide the AI (e.g. coding style, project conventions). |
| 🧠 | **Skills** | Agent skills and the `.cursor` folder structure (reusable capabilities the agent can load). |
| 🤖 | **Subagents** | Custom agent configurations (e.g. specialized subagents for different tasks). |
| ⚡ | **Commands** | Custom slash commands you can run from chat. |

---

**Versioning:** The extension version is defined in `package.json` (`version`). Cursor and `vsce` use that as the single source of truth. Release history is in [CHANGELOG.md](CHANGELOG.md) (semantic versioning).

**Docs:** [Cursor Docs](https://cursor.com/docs) — rules, skills, and related features.
