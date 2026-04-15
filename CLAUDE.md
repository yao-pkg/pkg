# CLAUDE.md

## Quick Reference

```bash
yarn build           # Build (required before testing)
yarn lint            # Check lint + formatting
yarn fix             # Auto-fix lint + formatting
yarn start           # Watch mode (rebuild on change)
yarn test:22         # Run tests for Node.js 22
```

> `pkg` uses **yarn** for dependency management. `npm` is only used in `docs-site/` (the VitePress docs). Do not create a root `package-lock.json`.

Detailed project rules are in `.claude/rules/` — they are loaded automatically.
Shared instructions for GitHub Copilot are in `.github/copilot-instructions.md`.
