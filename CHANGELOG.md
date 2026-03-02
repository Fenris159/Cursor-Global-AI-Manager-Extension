# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: (initial release)
