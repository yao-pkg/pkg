---
title: Getting started
description: Install pkg, package your first Node.js project into a single executable, and learn the CLI in under five minutes.
---

# Getting started

## Prerequisites

- **Node.js >= 22** on the build host (check with `node -v`)
- **npm or any Node.js package manager** (pnpm, yarn, bun all work)
- **~500 MB free disk** for cached base binaries on first run (`~/.pkg-cache/`)

Cross-compiling Linux / macOS / Windows binaries (and x64 / arm64) from a single host is supported on Node 20 and Node 24. Node 22 has a known Standard-mode regression — see [Targets → Cross-compilation support](/guide/targets#cross-compilation-support).

## Install

::: code-group

```sh [npm]
npm install -g @yao-pkg/pkg
```

```sh [pnpm]
pnpm add -g @yao-pkg/pkg
```

```sh [yarn]
yarn global add @yao-pkg/pkg
```

```sh [npx (no install)]
npx @yao-pkg/pkg .
```

:::

Verify the install:

```sh
pkg --version
```

## Build your first binary

Create a tiny project:

```sh
mkdir hello-pkg && cd hello-pkg
echo 'console.log("hello from a single binary!");' > index.js
```

Package it:

```sh
pkg index.js
```

You should now see three executables in the current directory:

```text
index-linux
index-macos
index-win.exe
```

Each is a fully self-contained binary — no Node.js required on the target machine. Run the one for your host:

::: code-group

```sh [Linux]
./index-linux
# → hello from a single binary!
```

```sh [macOS]
./index-macos
# → hello from a single binary!
```

```powershell [Windows]
.\index-win.exe
# → hello from a single binary!
```

:::

### Package a whole project

With a `package.json` in place, `pkg` follows its `bin` entry and walks your dependencies automatically:

```json
{
  "name": "hello-pkg",
  "version": "1.0.0",
  "bin": "index.js",
  "pkg": {
    "targets": ["node22-linux-x64", "node22-macos-arm64", "node22-win-x64"],
    "outputPath": "dist"
  }
}
```

Then:

```sh
pkg .
```

`pkg` reads the `pkg` property in `package.json`, targets just the three platforms listed, and drops the output into `dist/`. See [Configuration](/guide/configuration) for the full config schema and [Targets](/guide/targets) for the target triple syntax.

## CLI reference

| Flag                       | Short | Description                                                                                                          |
| -------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `--help`                   | `-h`  | Show usage                                                                                                           |
| `--version`                | `-v`  | Print pkg version                                                                                                    |
| `--targets <list>`         | `-t`  | Comma-separated target list, e.g. `node22-linux-x64` — see [Targets](/guide/targets)                                 |
| `--config <path>`          | `-c`  | Path to `package.json` or any JSON file with a top-level `pkg` config                                                |
| `--output <path>`          | `-o`  | Output file name (single-target builds only)                                                                         |
| `--out-path <dir>`         |       | Output directory for multi-target builds                                                                             |
| `--debug`                  | `-d`  | Verbose packaging log — see [Output & debug](/guide/output)                                                          |
| `--build`                  | `-b`  | Compile base binaries from source instead of downloading — see [Build](/guide/build)                                 |
| `--public`                 |       | Speed up packaging and disclose top-level sources                                                                    |
| `--public-packages <list>` |       | Force listed packages to be treated as public — see [Bytecode](/guide/bytecode)                                      |
| `--no-bytecode`            |       | Skip V8 bytecode compilation, embed source as plain JS — see [Bytecode](/guide/bytecode)                             |
| `--fallback-to-source`     |       | Ship files as plain source when bytecode generation fails instead of skipping them — see [Bytecode](/guide/bytecode) |
| `--no-native-build`        |       | Skip building native addons                                                                                          |
| `--no-dict <list>`         |       | Ignore bundled dictionaries for listed packages (`*` disables all)                                                   |
| `--options <list>`         |       | Bake V8 options into the executable — see [CLI options](/guide/options)                                              |
| `--compress <algo>`        | `-C`  | Compress the embedded filesystem with `Brotli` or `GZip` — see [Compression](/guide/compression)                     |
| `--sea`                    |       | Use Node.js SEA instead of the patched base binary — see [SEA mode](/guide/sea-mode)                                 |

Run `pkg --help` at any time for the live list of options.

## Next steps

- **[Targets](/guide/targets)** — cross-compile for other platforms
- **[Configuration](/guide/configuration)** — `pkg` property, assets, scripts, ignore
- **[SEA vs Standard](/guide/sea-vs-standard)** — which packaging mode to pick
- **[Recipes](/guide/recipes)** — copy-paste solutions for common tasks
- **[Troubleshooting](/guide/troubleshooting)** — if something breaks
