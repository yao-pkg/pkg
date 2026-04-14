---
title: Output & debug
description: Control where pkg writes its output and how to surface build-time and runtime diagnostics.
---

# Output & debug

## Output path

You have two flags:

| Flag         | Use when                                                                       |
| ------------ | ------------------------------------------------------------------------------ |
| `--output`   | You're building a **single** executable and want to choose its exact file name |
| `--out-path` | You're building **multiple** targets and want them all in one directory        |

```sh
# Single target, named output
pkg -t host -o dist/mytool index.js

# Multi target, into a directory
pkg -t node22-linux-x64,node22-win-x64,node22-macos-arm64 --out-path dist index.js
```

Or via `package.json`:

```json
{
  "pkg": {
    "targets": ["node22-linux-x64", "node22-macos-arm64", "node22-win-x64"],
    "outputPath": "dist"
  }
}
```

## Debug output

Pass `--debug` (or `-d`) to get a verbose log of the packaging process. If you have issues with a particular file (seems not packaged into the executable), the log tells you exactly which files the walker found and why it included or excluded each one.

```sh
pkg --debug index.js
```

For **runtime** diagnostics (what's actually inside the binary after it ships), build with `--debug` and then launch with one of the debug env vars:

| Variable             | What it does                                                      |
| -------------------- | ----------------------------------------------------------------- |
| `DEBUG_PKG=1`        | Prints the snapshot tree and symlink table at startup             |
| `DEBUG_PKG=2`        | Same as `=1`, plus mocks `fs` to log every filesystem call        |
| `SIZE_LIMIT_PKG=N`   | With `DEBUG_PKG`, log files larger than N bytes (default 5 MB)    |
| `FOLDER_LIMIT_PKG=N` | With `DEBUG_PKG`, log folders larger than N bytes (default 10 MB) |

```sh
pkg --debug index.js -o dist/app
DEBUG_PKG=1 ./dist/app
```

This is useful to see what's included in your bundle and detect missing or unnecessarily large files.

::: warning Do not ship debug builds
`--debug` binaries are slower, larger, and print sensitive path info at startup. Use for development only.
:::

## See also

- [Debug virtual FS](/guide/advanced-debug-vfs) — deep dive on `DEBUG_PKG`
- [Environment variables](/guide/environment)
- [Troubleshooting](/guide/troubleshooting)
