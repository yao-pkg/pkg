---
description: Build, lint, formatting, and TypeScript rules
---

# Development

## Package manager

`pkg` uses **yarn** (see `yarn.lock`). **Never run `npm install` / `npm ci` / `npm run X` at the repo root** — it will create a spurious `package-lock.json`. `npm` is used only inside `docs-site/` (the VitePress site has its own `package-lock.json`).

## Build

```bash
yarn build    # Required before testing — compiles lib/ to lib-es5/
yarn start    # Watch mode with auto-rebuild
```

## Lint & Format

```bash
yarn lint         # Check both ESLint + Prettier
yarn fix          # Auto-fix all issues
yarn lint:code    # ESLint only
yarn lint:style   # Prettier only
```

- Always run `yarn lint` before committing. Fix all issues — never push dirty code.
- Console statements are disallowed in production code but allowed in test files.

## TypeScript

- Strict mode enabled. Target: ES2022. Module system: CommonJS.
- Edit `lib/*.ts` only — never edit `lib-es5/*.js` directly.
- Requires Node.js >= 22.0.0.

## Dependencies

- Keep runtime dependencies minimal — they affect all packaged apps.
- Use exact or caret ranges.
- `pkg-fetch` provides pre-compiled Node.js binaries.
