---
title: SEA mode
description: Use Node.js Single Executable Applications to package your project with stock, unmodified Node.js binaries.
---

# SEA mode

`--sea` packages your project using **stock, unmodified Node.js** via the official [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) API — no custom patches, no `pkg-fetch`.

Looking for a conceptual overview? Jump to [SEA vs Standard](/guide/sea-vs-standard) for the full comparison, feature matrix, and patch-elimination roadmap.

## Your first SEA binary

Create the same hello project as in [Getting started](/guide/getting-started):

```sh
mkdir hello-sea && cd hello-sea
echo 'console.log("stock-node hello!");' > index.js
```

Package it with SEA mode:

```sh
pkg index.js --sea
```

Run it:

```sh
./index-linux   # or index-macos / index-win.exe
# → stock-node hello!
```

That's it. No patched Node, no `pkg-fetch` cache touched.

## Two SEA variants

`pkg` picks the variant automatically based on the input.

### Simple SEA — single `.js` file

For a single pre-bundled `.js` file (Node 22+):

```sh
pkg --sea index.js
```

Node.js SEA supports exactly one entry file. Use this when your project is already bundled (webpack, esbuild, rollup) into one JS file.

### Enhanced SEA — full project with `package.json`

Automatically used when the input has a `package.json` and all targets are Node >= 22. Uses the full dependency walker with [`@roberts_lando/vfs`](https://www.npmjs.com/package/@roberts_lando/vfs) for transparent `fs` / `require` / `import` support:

```sh
pkg . --sea                    # walks deps, builds VFS
pkg . --sea -t node24-linux    # target a specific platform
```

::: code-group

```sh [CLI]
pkg . --sea -t node24-linux-x64
```

```json [package.json]
{
  "bin": "src/cli.js",
  "pkg": {
    "targets": ["node24-linux-x64", "node24-macos-arm64", "node24-win-x64"],
    "outputPath": "dist",
    "sea": true
  }
}
```

```js [Node.js API]
const { exec } = require('@yao-pkg/pkg');
await exec(['.', '--sea', '--out-path', 'dist']);
```

:::

## What enhanced SEA does

- **Walks dependencies** like traditional mode, but **skips V8 bytecode and ESM→CJS transforms** — files stay as-is
- **Bundles all files** into a single archive blob with offset-based zero-copy access at runtime
- **Worker threads** — VFS hooks are automatically injected into `/snapshot/...` workers
- **Native addon extraction** — works the same as traditional mode
- **ESM entry points** (`"type": "module"`) work on every supported target (Node >= 22), **including top-level await**. Dispatched via `vm.Script` + `USE_MAIN_CONTEXT_DEFAULT_LOADER`; no Node-version split, no build-time warning. CJS entries go through `Module.runMain()`.
- **Runtime diagnostics** (`DEBUG_PKG` / `SIZE_LIMIT_PKG` / `FOLDER_LIMIT_PKG`) work the same as traditional mode — but only when built with `--debug`.
- **Migration path** to **`node:vfs`** when it lands in Node.js core.

::: warning seaConfig.useSnapshot
Not supported in enhanced SEA mode (incompatible with the VFS bootstrap). Set it to `false` or omit it. `useCodeCache` is forwarded as-is.
:::

## Trade-offs vs Standard mode

Enhanced SEA builds faster and uses **official Node.js APIs**. Per-file compression (`--compress Brotli` / `GZip` / `Zstd`) is supported and closes most of the size gap with Standard mode. Workers, native addons, ESM, cross-compile and targets all work the same.

For the full feature matrix and decision guide, see **[SEA vs Standard](/guide/sea-vs-standard)**.

## Next steps

- **[SEA vs Standard](/guide/sea-vs-standard)** — feature matrix + roadmap
- **[Recipes](/guide/recipes)** — copy-paste SEA build recipes
- **[Architecture: Enhanced SEA](/architecture#enhanced-sea-mode-in-one-paragraph)** — deep dive on VFS + bootstrap internals
