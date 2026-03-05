# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-03-02

### Added

- **Hooks management.** Full support for user-level agent hooks: manage `~/.cursor/hooks.json` and scripts in `~/.cursor/hooks/` from the sidebar. Enable or disable scripts per event via checkbox; create new scripts, import from disk, sync to workspace, or export. First run creates empty `hooks.json` and 20 default stub scripts if missing; **Spawn placeholders** restores missing default script files. Hooks landing page documents all 20 events, script contract (stdin JSON, exit 0/2), and Windows/Node notes.
- Overview and hooks-landing documentation expanded for first-time users: how to open the panel (status bar / Command Palette), what “user-level” means, sidebar category descriptions, when hooks run, multiple scripts per event, and script contract details.

### Fixed

- Sidebar “?” buttons and overview Documentation links now open Cursor docs correctly (injection of `DOC_URLS` and related globals moved to run before the webview script).

## [1.0.0] - 2025-03-02

### Added

- Manage user-level rules, skills, subagents, and commands from one panel.
- Browse, preview, and edit files in `~/.cursor/` (rules, skills, subagents, commands).
- Create new files with category templates; import/export and sync to workspace.
- Rule frontmatter UI (Always Apply, Apply Intelligently, Apply to Specific Files, Apply Manually).
- Timestamped backups to `~/.cursor/.backups/` before overwrites.
- Optional `cursorGlobalAI.globalCursorPath` setting to override global .cursor location.
- Lazy-loaded Monaco preview, debounced filesystem watcher, parsed-content cache.
- Platform-agnostic paths; Windows fallback `scripts\compile.cmd` for build.

[2.0.0]: https://github.com/Fenris159/Cursor-Global-AI-Manager-Extension/compare/v1.0.0...v2.0.0
[1.0.0]: (initial release)
