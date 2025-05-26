# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `pnpm dev` - Start all dev servers
- `pnpm dev:toolbar` - Start toolbar packages dev servers
- `pnpm dev:plugins` - Start plugins dev servers
- `pnpm dev:examples` - Start example apps dev servers

### Build
- `pnpm build` - Build all packages
- `pnpm build:toolbar` - Build toolbar packages only
- `pnpm build:packages` - Build packages only
- `pnpm build:apps` - Build apps only

### Code Quality
- `pnpm check` - Run Biome linter/formatter checks
- `pnpm check:fix` - Auto-fix Biome issues
- `pnpm typecheck` - Run TypeScript type checking
- `pnpm test` - Run tests across all packages

### Versioning
- `pnpm changeset` - Create a changeset for version bumps
- `pnpm changeset --empty` - Create empty changeset for non-code changes

## Architecture Overview

This is a monorepo for Stagewise, a browser toolbar that connects frontend UI to AI agents in code editors.

### Key Components

1. **Browser Toolbar** (`toolbar/`)
   - `core/` - Framework-agnostic toolbar implementation
   - `react/`, `vue/`, `next/` - Framework-specific adapters
   - Provides DOM element selection, screenshot capture, and metadata extraction

2. **VSCode Extension** (`apps/vscode-extension/`)
   - Bridge between browser toolbar and IDE
   - Implements HTTP server for SSE communication
   - Integrates with Cursor and Windsurf AI agents via MCP tools

3. **Communication Layer**
   - SRPC (typed RPC) for toolbar-extension communication
   - Server-Sent Events (SSE) for real-time updates
   - Type-safe contracts in `packages/extension-*-contract/`

4. **Plugin System** (`plugins/`)
   - Extensible architecture for custom functionality
   - React template provided for creating new plugins

### Development Workflow

1. **Making Changes**: Follow existing code patterns and conventions
2. **Testing**: Run single tests with framework-specific commands (check package.json)
3. **Changesets**: Required for all changes to published packages
4. **Commits**: Use conventional commit format (enforced by commitlint)

### Important Notes

- Monorepo uses pnpm workspaces and Turborepo for build orchestration
- Biome for linting/formatting (not ESLint/Prettier)
- Strict TypeScript configuration across all packages
- Framework packages are published to npm as `@stagewise/toolbar-{framework}`