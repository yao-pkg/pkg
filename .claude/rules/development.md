---
description: Build, lint, formatting, and TypeScript rules
---

# Development

## Build

```bash
npm run build    # Required before testing — compiles lib/ to lib-es5/
npm run start    # Watch mode with auto-rebuild
```

## Lint & Format

```bash
npm run lint         # Check both ESLint + Prettier
npm run fix          # Auto-fix all issues
npm run lint:code    # ESLint only
npm run lint:style   # Prettier only
```

- Always run `npm run lint` before committing. Fix all issues — never push dirty code.
- Console statements are disallowed in production code but allowed in test files.

## TypeScript

- Strict mode enabled. Target: ES2017. Module system: CommonJS.
- Edit `lib/*.ts` only — never edit `lib-es5/*.js` directly.
- Requires Node.js >= 20.0.0.

## Dependencies

- Keep runtime dependencies minimal — they affect all packaged apps.
- Use exact or caret ranges.
- `pkg-fetch` provides pre-compiled Node.js binaries.
