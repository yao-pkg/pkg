---
title: Environment variables
description: Build-time and runtime environment variables that influence pkg behaviour — cache paths, native addon extraction, debug output.
---

# Environment variables

`pkg` honours its own variables plus those from `pkg-fetch` (used during base-binary download). This page lists the complete set.

## Build-time

Set before running the `pkg` command.

| Variable                     | Default         | Description                                                                          |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `PKG_CACHE_PATH`             | `~/.pkg-cache/` | Where `pkg-fetch` caches downloaded Node.js base binaries                            |
| `PKG_IGNORE_TAG`             | unset           | If set, `pkg-fetch` ignores the built-in release tag and uses `latest`               |
| `HTTP_PROXY` / `HTTPS_PROXY` | unset           | Proxy forwarded to `pkg-fetch` downloads                                             |
| `PKG_STRICT_VER`             | unset           | Enable walker assertions — each file state must apply to a real file, not a symlink  |
| `NODE_OPTIONS`               | unset           | Honoured as per Node.js; see [Troubleshooting](/guide/troubleshooting) for conflicts |

For the full `pkg-fetch` environment list, see the [`pkg-fetch` README](https://github.com/yao-pkg/pkg-fetch#environment).

## Runtime (inside the packaged app)

Set when **running** a binary produced by `pkg`.

| Variable                | Default               | Description                                                                               |
| ----------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| `CHDIR`                 | unset                 | Override `process.chdir` at startup                                                       |
| `PKG_NATIVE_CACHE_PATH` | `~/.cache/pkg-native` | Base directory for extracted native addons — see [Native addons](/guide/native-addons)    |
| `PKG_EXECPATH`          | set by `pkg`          | Used internally to detect pkg-launched processes — see note below                         |
| `DEBUG_PKG`             | unset                 | `1` prints snapshot tree; `2` also mocks `fs` to log every call. Requires `--debug` build |
| `SIZE_LIMIT_PKG`        | `5242880` (5 MB)      | With `DEBUG_PKG`, log files larger than this many bytes                                   |
| `FOLDER_LIMIT_PKG`      | `10485760` (10 MB)    | With `DEBUG_PKG`, log folders larger than this many bytes                                 |

::: warning PKG_EXECPATH
`PKG_EXECPATH` is set by `pkg` at runtime and **should not be overridden in normal use**. There is one documented exception: when spawning a child process via `child_process` where you want the child to run a _different_ Node.js binary instead of the packaged one. Set `PKG_EXECPATH: ''` in the child's `env` — see the [child_process recipe in Troubleshooting](/guide/troubleshooting#error-cannot-find-module-xxx-when-using-child-process).
:::

## Examples

```bash
# 1. Build-time: override pkg-fetch cache path
export PKG_CACHE_PATH=/my/cache
pkg app.js

# 2. Runtime: override native-addon extraction path
PKG_NATIVE_CACHE_PATH=/opt/myapp/cache ./myapp

# 3. Build-time + runtime
PKG_CACHE_PATH=/build/cache pkg app.js
PKG_NATIVE_CACHE_PATH=/runtime/cache ./myapp

# 4. Debug a packaged binary
pkg --debug app.js
DEBUG_PKG=1 SIZE_LIMIT_PKG=1000000 ./app
```
