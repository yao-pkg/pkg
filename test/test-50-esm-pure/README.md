# Test ESM Pure Module

This test demonstrates the issue with pure ESM modules in pkg.

## The Problem

1. **Pure ESM packages** (like `nanoid` v4+) use `"type": "module"` in their package.json
2. They export `.js` files that are ESM modules, not CommonJS
3. The `resolve` package used by pkg's `follow.ts` follows Node.js CommonJS resolution
4. When pkg tries to resolve and require these modules, it fails because:
   - `require()` cannot load ESM modules
   - The `resolve` package doesn't understand ESM exports/imports field in package.json
   - Node.js requires `import()` or `--experimental-require-module` flag

## Expected Error

When running this test, you should see an error like:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module .../node_modules/nanoid/index.js not supported.
Instead change the require of index.js to a dynamic import() which is available in all CommonJS modules.
```

## What Needs to Be Fixed

1. **Module Resolution**: Replace or extend `resolve` package to understand:

   - `"type": "module"` field in package.json
   - `"exports"` field for conditional exports
   - `.mjs` file extensions
   - ESM module detection

2. **Import Detection**: Extend `detector.ts` to handle:

   - Dynamic `import()` expressions
   - Top-level `await`
   - ESM re-exports (`export * from '...'`)

3. **Module Loading**: Handle ESM modules during:
   - Dependency graph walking
   - Bytecode compilation
   - Runtime execution in packaged binary

## Running the Test

```bash
cd test-50-esm-pure
npm install
cd ..
node main.js
```
