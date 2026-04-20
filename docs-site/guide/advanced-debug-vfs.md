---
title: Debug virtual FS
description: Inspect the contents of a packaged binary's virtual filesystem at runtime with DEBUG_PKG.
---

# Exploring the virtual filesystem in debug mode

When you build with `--debug`, `pkg` injects a diagnostic prelude into the binary. At runtime, setting the `DEBUG_PKG` environment variable dumps the virtual filesystem tree and the symlink table to the console at startup — before your app runs.

Use this workflow to answer "why isn't my asset in the binary?" and "which dependency is bloating my bundle?".

## Basic usage

::: code-group

```sh [Linux / macOS]
pkg --debug app.js -o dist/app
DEBUG_PKG=1 ./dist/app
```

```bat [Windows]
pkg --debug app.js -o dist\app.exe
set DEBUG_PKG=1
dist\app.exe
```

:::

`DEBUG_PKG=1` prints the snapshot tree and symlink table.
`DEBUG_PKG=2` additionally mocks `fs` to log **every** filesystem call the running app makes — file opens, stats, readdirs — so you can see exactly which paths your code touches.

## Filtering noise

The snapshot tree can be large. Two env vars limit the output to files / folders larger than a threshold:

```sh
# Only show files bigger than 1 MB and folders bigger than 5 MB
SIZE_LIMIT_PKG=1048576 FOLDER_LIMIT_PKG=5242880 DEBUG_PKG=1 ./dist/app
```

Defaults: `SIZE_LIMIT_PKG=5242880` (5 MB), `FOLDER_LIMIT_PKG=10485760` (10 MB).

## Typical workflow

1. Build **once** with `--debug`:
   ```sh
   pkg --debug . -o dist/app
   ```
2. List everything:
   ```sh
   DEBUG_PKG=1 ./dist/app
   ```
3. Spot the offender — usually a big `test/` or `docs/` folder inside a dependency.
4. Add it to `pkg.ignore` in `package.json`:
   ```json
   {
     "pkg": {
       "ignore": ["**/node_modules/*/test/**", "**/node_modules/*/docs/**"]
     }
   }
   ```
5. Rebuild **without** `--debug` for production.

::: warning Never ship --debug builds
Debug builds are slower, larger, and print sensitive internal paths at launch. They are for development only. Release builds cannot be coerced into dumping the VFS tree, which is intentional.
:::

## See also

- [Output & debug](/guide/output)
- [Environment variables](/guide/environment)
- [Configuration → ignore](/guide/configuration#ignore-files)
- [Claude Code `/pkg-debug` skill](/guide/troubleshooting#ai-assisted-debugging-with-claude-code) — interactive AI-assisted troubleshooting
