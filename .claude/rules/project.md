---
description: Project overview, structure, and key files for yao-pkg/pkg
---

# Project Overview

`pkg` packages Node.js projects into standalone executables for Linux, macOS, and Windows. It supports Node.js 22 and newer, virtual filesystem bundling, V8 bytecode compilation, native addons, and compression (Brotli, GZip).

This is `yao-pkg/pkg` — a maintained fork of the archived `vercel/pkg`.

## Repository Structure

- `lib/` — TypeScript source (compiled to `lib-es5/` via `npm run build`)
- `prelude/` — Bootstrap code injected into packaged executables
- `dictionary/` — Package-specific configs for known npm packages
- `test/` — Numbered test directories (`test-XX-name/`)
- `.github/workflows/` — CI/CD (GitHub Actions)

## Key Entry Points

- `lib/index.js` — API entry point
- `lib/bin.js` — CLI entry point
- `prelude/bootstrap.js` — Injected into every packaged executable
- `dictionary/*.js` — Special handling for specific npm packages

## Architecture Reference

- `docs/ARCHITECTURE.md` — **detailed** contributor/agent reference. Full build pipelines, binary layout, VFS provider, worker-thread bootstrap, patch tables. Read this when working on `lib/` or `prelude/`.
- `docs-site/architecture.md` — short user-facing overview (linked from the published docs site). Don't duplicate internals here; link back to `docs/ARCHITECTURE.md`.
