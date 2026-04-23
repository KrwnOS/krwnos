# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Released `core.tasks` module: A premium Trello-like Kanban board integrated into KrwnOS. Features glassmorphic UI, rich drag-and-drop animations via `@dnd-kit`, and is strictly permission-scoped per Vertical Node. Access it via `/dashboard/tasks`. (Added by Antigravity AI on 2026-04-22)
- Implemented Database Sandboxing Architecture for third-party modules. Modules now access the database through an isolated `search_path` via `ModuleContext.db.transaction`, protecting core tables. (Added by Antigravity AI on 2026-04-22)
- Added `ModuleContext.secrets` to securely expose module secrets from `InstalledModule.config`. (Added by Antigravity AI on 2026-04-22)
- Created `CHANGELOG.md` to track ongoing developments and changes. (Added by Antigravity AI on 2026-04-22)
- Added `.cursor/rules/changelog.mdc` to instruct AI agents to automatically maintain this changelog. (Added by Antigravity AI on 2026-04-22)
