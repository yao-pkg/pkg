---
description: Git workflow, commit conventions, and PR rules
---

# Git & PR Workflow

## CRITICAL: PR Target

- ALWAYS create PRs against `yao-pkg/pkg` (this fork).
- NEVER target `vercel/pkg` — it is archived and read-only.

## Commits

- Use conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`
- Default branch: `main`. Tag format: `v${version}`.
- Branch protection requires passing CI checks.

## Before Committing

1. Clean test artifacts from test directories (`*.exe`, `*-linux`, `*-macos`, `*-win.exe`).
2. Run `npm run lint` and fix all issues.
3. Show `git status --short` and get user approval before committing.

## Release

Uses `release-it` with conventional commits (`npm run release`). This runs linting, generates changelog, creates a git tag, pushes to GitHub, and publishes to npm as `@yao-pkg/pkg`.
