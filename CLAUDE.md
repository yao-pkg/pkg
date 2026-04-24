# CLAUDE.md

## Quick Reference

```bash
yarn build           # Build (required before e2e testing)
yarn lint            # Check lint + formatting
yarn fix             # Auto-fix lint + formatting
yarn start           # Watch mode (rebuild on change)
yarn test:unit       # Fast in-process unit suite (node:test, ~1s)
yarn test:22         # Run e2e tests for Node.js 22
```

> `pkg` uses **yarn** for dependency management. `npm` is only used in `docs-site/` (the VitePress docs). Do not create a root `package-lock.json`.

Detailed project rules are in `.claude/rules/` — they are loaded automatically.
Shared instructions for GitHub Copilot are in `.github/copilot-instructions.md`.
