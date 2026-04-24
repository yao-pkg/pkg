---
description: Test commands, organization, and patterns
paths:
  - 'test/**'
---

# Testing

## Commands

```bash
yarn test:unit                         # Fast in-process unit suite (node:test, ~1s, no build)
yarn test:unit:watch                   # Unit suite in watch mode

yarn build                             # Required before e2e suite
yarn test:22                           # E2E with Node.js 22
yarn test:host                         # E2E with host Node.js version
node test/test.js node22 no-npm test-50-*   # Run specific e2e pattern

yarn coverage:unit                     # c8 unit coverage → coverage/lcov.info
yarn coverage                          # Merged unit + e2e coverage (slow)
```

## Organization

Two suites:

- **Unit suite** (`test/unit/*.test.ts`) — `node:test` runner, imports `lib/*.ts` via `esbuild-register`. Pure in-process, no binaries produced.
- **E2E suite** (`test/test-XX-descriptive-name/main.js`) — each directory spawns the `pkg` CLI and asserts on the produced binary. XX = execution order.

Special e2e tests:

- `test-79-npm/` — npm package integration tests (only-npm).
- `test-42-fetch-all/` — verifies patches exist for all Node.js versions.

## Writing Tests

Prefer a unit test when the thing under test is a pure function in `lib/*.ts` (parsers, path helpers, selectors, etc.) — they're ~1s and give much better iteration speed than a full build+spawn cycle.

**Unit test** (`test/unit/your-thing.test.ts`):

1. Use `import { describe, it } from 'node:test'` and `import assert from 'node:assert/strict'`.
2. Import the thing directly from `../../lib/...` — no need for `lib-es5/`.
3. For platform-specific logic, skip the wrong half with `describe(..., { skip: !onWin }, ...)`.

**E2E test** (`test/test-XX-descriptive-name/main.js`):

1. Create the directory with a `main.js`.
2. Use `utils.pkg.sync()` to invoke pkg.
3. Verify outputs, clean up with `utils.filesAfter()`.

Test artifacts (`*.exe`, `*-linux`, `*-macos`, `*-win.exe`) must be cleaned from test directories before committing.
