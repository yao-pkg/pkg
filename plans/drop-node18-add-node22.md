# Plan: Drop node18 target, add node22 target

## Context

The project currently supports `node18` and `node20` as compilation targets (plus `host`). The user wants to drop `node18` and add `node22` instead, updating CI, source code, tests, and documentation accordingly.

## Changes

### 1. CI Workflows

**`.github/workflows/ci.yml`**

- Change build matrix from `[18.x, 20.x]` to `[20.x, 22.x]`
- Change lint condition from `node-version == '18.x'` to `node-version == '20.x'`
- Replace `test_18` job with `test_22` (calling `test:22`)
- Keep `test_20` and `test_host`

**`.github/workflows/test.yml`**

- Change test matrix from `[18.x, 20.x]` to `[20.x, 22.x]`

### 2. Package configuration

**`package.json`**

- Update `engines.node` from `>=18.0.0` to `>=20.0.0`
- Replace `test:18` script with `test:22`: `"node test/test.js node22 no-npm"`
- Update `test` script to call `test:22` instead of `test:18`

### 3. ESM Transformer

**`lib/esm-transformer.ts`** (line 379)

- Change esbuild target from `'node18'` to `'node20'` (new minimum supported version)

### 4. Tests

**`test/test-42-fetch-all/main.js`** (line 18)

- Change `nodeRanges` from `['node18', 'node20', 'node22']` to `['node20', 'node22']`

**`test/test-50-fs-runtime-layer-3/main.js`** (lines 29-32)

- The `node18`-specific branch is no longer needed. Since we only target node20+, the error message is always the ENOENT variant. Remove the `node18` conditional and use the `node20+` behavior unconditionally.

### 5. Documentation & templates

**`lib/help.ts`** (line 35)

- Update example from `node16-linux,node18-linux,node18-win` to `node20-linux,node22-linux,node22-win`

**`README.md`** (lines 56, 85)

- Update example from `node16-linux,node18-linux,node18-win` to `node20-linux,node22-linux,node22-win`
- Update target example from `node18-macos-x64` to `node20-macos-x64`

**`.github/copilot-instructions.md`**

- Update node version references (node18 -> node20, matrix mention, lint reference, engines note)

**`.github/ISSUE_TEMPLATE/01_bug_report.yml`** and **`02_regression.yml`**

- Update example targets from `node18` to `node20`

## Verification

1. `yarn build` — ensure TypeScript compiles cleanly
2. `yarn lint` — ensure no lint errors
3. `yarn test:host` — run host-target tests
4. `yarn test:20` — run node20 target tests
5. `yarn test:22` — run new node22 target tests
