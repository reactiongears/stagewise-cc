---
description: 
globs: 
alwaysApply: false
---
# Monorepo Guide

This repository is a monorepo managed with pnpm workspaces. Understanding its structure is key to navigating and contributing effectively.

## Workspace Configuration

The workspace structure is defined in `[pnpm-workspace.yaml](mdc:pnpm-workspace.yaml)`. It includes the following main package locations:

*   `apps/*`
*   `packages/*`
*   `playgrounds/*`
*   `examples/*`
*   `toolbar/*`
*   `plugins/*`

## Key Directories and Their Purpose

*   **`apps/`**: Contains runnable applications. For example:
    *   `apps/vscode-extension`: The VS Code extension.
    *   `apps/website`: The project's website.
    *   When making changes here, the commit scope should be the app's directory name (e.g., `feat(vscode-extension): ...`).

*   **`packages/`**: Contains shared libraries or utilities used by different `apps` or other `packages`. For example:
    *   `packages/extension-toolbar-srpc-contract`: Defines sRPC contracts.
    *   `packages/srpc`: sRPC implementation.
    *   `packages/typescript-config`: Shared TypeScript configurations.
    *   `packages/ui`: Shared UI components or styles.
    *   When making changes here, the commit scope should be the package's directory name (e.g., `fix(ui): ...`).

*   **`toolbar/`**: Contains code specifically related to the toolbar functionality. This might include core logic, UI elements, or extensions for the toolbar.
    *   Refer to the `[plugin-creation-guide.md](mdc:.roo/rules/plugin-creation-guide.md)` for developing toolbar plugins.
    *   Commit scope for changes here is `toolbar` or a more specific sub-directory if applicable (e.g., `refactor(toolbar/core): ...`).

*   **`plugins/`**: Likely contains plugins or extensions for various parts of the system, potentially for different host applications or platforms.
    *   Commit scope should be the plugin's directory name (e.g., `feat(my-plugin): ...`).

*   **`examples/`**: Contains example implementations or usage demonstrations of packages or features.
    *   Commit scope depends on what the example is for, often the example's directory name or the package it demonstrates.

*   **`playgrounds/`**: Provides environments for experimenting with features or packages in isolation.
    *   Commit scope depends on the specific playground's focus.

*   **`.roo/rules/`**: Contains Markdown (`.md`) files that define rules and guidelines for LLM interaction with this codebase. Changes here use the `roo-rules` scope.
    *   Example: `docs(roo-rules): update commit message guide`

## Package Management with PNPM

*   **Package Manager**: This project uses `pnpm`. Always use `pnpm` commands for installing, updating, and managing dependencies (e.g., `pnpm install`, `pnpm add <package> -w` to add to root, or `pnpm add <package> --filter <package-name>` to add to a specific package).
*   **Running Scripts**: Scripts defined in `package.json` files should be run using `pnpm run <script-name>` from the respective package directory, or `pnpm --filter <package-name> run <script-name>` from the root.
*   **Inter-package Dependencies**: Local packages can be linked using workspace protocol `workspace:*` in `package.json` files.

## Commit Scopes Reminder

As detailed in the `[commit-message-guide.md](mdc:.roo/rules/commit-message-guide.md)`, the commit scope is crucial and directly relates to these directories:

*   `root`: For root-level files (`package.json`, `tsconfig.json`, etc.).
*   `roo-rules`: For `.roo/rules/`.
*   `toolbar`: For `apps/toolbar/` or `toolbar/*`.
*   `docs`: For `docs/`.
*   `deps`: For dependency updates.
*   **Package Name**: For changes in `apps/<app-name>`, `packages/<package-name>`, `plugins/<plugin-name>`, etc.

Adhering to these structural and commit conventions will help maintain clarity and consistency across the project.
