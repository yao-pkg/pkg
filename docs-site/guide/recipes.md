---
title: Recipes
description: Copy-paste solutions for common pkg tasks — cross-compile, compression, native addons, SEA mode, CI builds.
---

# Recipes

Copy-paste solutions for tasks you actually do. Each recipe is self-contained — no prose, just the config and the command.

**Jump to a recipe:**

- [Build a binary for every mainstream platform](#build-a-binary-for-every-mainstream-platform)
- [Smallest possible binary (Brotli + Standard mode)](#smallest-possible-binary-brotli-standard-mode)
- [Reproducible builds (no bytecode, same hash every time)](#reproducible-builds-no-bytecode-same-hash-every-time)
- [Bundle a native SQLite addon](#bundle-a-native-sqlite-addon)
- [Ship an ESM project with top-level await](#ship-an-esm-project-with-top-level-await)
- [Build all targets in CI](#build-all-targets-in-ci)
- [Programmatic build with the Node.js API](#programmatic-build-with-the-node-js-api)
- [Bake V8 heap limit into the binary](#bake-v8-heap-limit-into-the-binary)
- [Cross-compile to Linux arm64 without QEMU](#cross-compile-to-linux-arm64-without-qemu)
- [Exclude test and doc directories from dependencies](#exclude-test-and-doc-directories-from-dependencies)
- [Use a glob to bundle all SQL migrations](#use-a-glob-to-bundle-all-sql-migrations)
- [Debug a missing asset](#debug-a-missing-asset)
- [Pin the base binary cache path (CI / enterprise)](#pin-the-base-binary-cache-path-ci-enterprise)

## Build a binary for every mainstream platform

::: code-group

```sh [CLI]
pkg -t node22-linux-x64,node22-linux-arm64,node22-macos-x64,node22-macos-arm64,node22-win-x64 --out-path dist .
```

```json [package.json]
{
  "pkg": {
    "targets": [
      "node22-linux-x64",
      "node22-linux-arm64",
      "node22-macos-x64",
      "node22-macos-arm64",
      "node22-win-x64"
    ],
    "outputPath": "dist"
  }
}
```

:::

## Smallest possible binary (Brotli + Standard mode)

```sh
pkg -C Brotli -t node22-linux-x64 --out-path dist .
```

Combine with `--no-dict *` to drop `dictionary/` patches and shave a few more KB:

```sh
pkg -C Brotli --no-dict '*' -t node22-linux-x64 --out-path dist .
```

## Reproducible builds (no bytecode, same hash every time)

```sh
pkg --no-bytecode --public-packages '*' --public -t node22-linux-x64 -o dist/app .
sha256sum dist/app
```

See [Bytecode → Reproducible builds](/guide/bytecode#reproducible-builds).

## Bundle a native SQLite addon

```json
{
  "pkg": {
    "targets": ["node22-linux-x64", "node22-win-x64"],
    "assets": ["node_modules/better-sqlite3/build/Release/better_sqlite3.node"],
    "outputPath": "dist"
  }
}
```

```sh
pkg .
```

The `.node` file is extracted to `$HOME/.cache/pkg-native/` on first launch — change the destination with `PKG_NATIVE_CACHE_PATH`. See [Native addons](/guide/native-addons).

## Ship an ESM project with top-level await

`package.json`:

```json
{
  "type": "module",
  "bin": "src/main.js",
  "pkg": {
    "targets": ["node22-linux-x64"],
    "sea": true
  }
}
```

```sh
pkg .
```

[Enhanced SEA mode](/guide/sea-mode#enhanced-sea--full-project-with-package-json) handles ESM entrypoints + top-level await natively. No async-IIFE transform.

## Build all targets in CI

GitHub Actions:

```yaml
name: Release binaries
on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx @yao-pkg/pkg . --out-path dist
      - uses: actions/upload-artifact@v4
        with:
          name: binaries
          path: dist/
```

## Programmatic build with the Node.js API

```js
const { exec } = require('@yao-pkg/pkg');

await exec([
  '.',
  '--targets',
  'node22-linux-x64,node22-macos-arm64,node22-win-x64',
  '--out-path',
  'dist',
  '--compress',
  'Brotli',
]);
```

See [API](/guide/api) for full usage.

## Bake V8 heap limit into the binary

```sh
pkg --options max-old-space-size=4096,expose-gc .
```

Users can't override — the flags always apply. See [CLI options](/guide/options).

## Cross-compile to Linux arm64 without QEMU

```sh
pkg --no-bytecode --public-packages '*' --public -t node22-linux-arm64 .
```

Skips the bytecode step, so there's no need to run an arm64 interpreter on your x64 host. Trade-off: source is plaintext in the binary. See [Targets → Cross-compilation support](/guide/targets#cross-compilation-support).

## Exclude test and doc directories from dependencies

```json
{
  "pkg": {
    "ignore": [
      "**/node_modules/*/test/**",
      "**/node_modules/*/tests/**",
      "**/node_modules/*/docs/**",
      "**/node_modules/*/example/**",
      "**/node_modules/*/examples/**"
    ]
  }
}
```

Typically shaves 10–30 % off the final binary. See [Configuration → ignore](/guide/configuration#ignore-files).

## Use a glob to bundle all SQL migrations

```json
{
  "pkg": {
    "assets": ["migrations/**/*.sql"]
  }
}
```

In code:

```js
const path = require('node:path');
const fs = require('node:fs');

const dir = path.join(__dirname, 'migrations');
const files = fs.readdirSync(dir).sort();
for (const f of files) {
  console.log('running', f);
  // ...
}
```

Works because `fs.readdirSync` on a `/snapshot/...` path reads from the virtual filesystem. See [Snapshot filesystem](/guide/snapshot-fs).

## Debug a missing asset

```sh
pkg --debug -o dist/app .
DEBUG_PKG=1 ./dist/app 2>&1 | grep my-missing-file
```

Full workflow in [Debug virtual FS](/guide/advanced-debug-vfs).

## Pin the base binary cache path (CI / enterprise)

```sh
export PKG_CACHE_PATH=/var/cache/pkg
pkg .
```

Keeps the `pkg-fetch` downloads outside `$HOME`, useful in locked-down build environments. See [Environment variables](/guide/environment).

## Next steps

Looking for something that's not here? Open an issue on [yao-pkg/pkg](https://github.com/yao-pkg/pkg/issues) and we'll add the recipe.
