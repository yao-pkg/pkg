# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Shared Instructions

Project-level AI coding instructions are maintained in a single shared location:

- **[`.github/copilot-instructions.md`](.github/copilot-instructions.md)** — the primary reference for project overview, architecture, development workflow, testing, coding standards, and contribution guidelines.

Please read that file for full context before making changes.

## Quick Reference

```bash
# Build (required before testing)
npm run build

# Lint and auto-fix
npm run lint
npm run fix

# Run all tests
npm test

# Run tests for a specific Node.js version
npm run test:20
npm run test:22
npm run test:24

# Watch mode (rebuild on change)
npm run start
```
