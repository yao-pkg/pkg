---
description: Test commands, organization, and patterns
paths:
  - 'test/**'
---

# Testing

## Commands

```bash
npm run build                          # Always build first
npm run test:20                        # Test with Node.js 20
npm run test:22                        # Test with Node.js 22
npm run test:host                      # Test with host Node.js version
node test/test.js node20 no-npm test-50-*   # Run specific test pattern
```

## Organization

- Tests live in `test/test-XX-descriptive-name/` directories (XX = execution order).
- Each test has a `main.js` entry point using utilities from `test/utils.js`.
- `test-79-npm/` — npm package integration tests (only-npm).
- `test-42-fetch-all/` — verifies patches exist for all Node.js versions.

## Writing Tests

1. Create `test/test-XX-descriptive-name/` with a `main.js`
2. Use `utils.pkg.sync()` to invoke pkg
3. Verify outputs, clean up with `utils.filesAfter()`

Test artifacts (`*.exe`, `*-linux`, `*-macos`, `*-win.exe`) must be cleaned from test directories before committing.
