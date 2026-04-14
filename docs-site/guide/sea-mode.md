# SEA Mode

The `--sea` flag uses Node.js [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) to package your project. SEA mode uses **stock, unmodified Node.js** — no custom patches, no `pkg-fetch`.

There are two variants.

## Simple SEA

For a single pre-bundled `.js` file (Node 22+):

```sh
pkg --sea index.js
```

## Enhanced SEA

Automatically used when the input has a `package.json` and all targets are Node >= 22. Uses the full dependency walker with [`@roberts_lando/vfs`](https://github.com/robertsLando/vfs) for transparent `fs` / `require` / `import` support:

```sh
pkg . --sea                    # walks dependencies, builds VFS
pkg . --sea -t node24-linux    # target specific platform
```

Enhanced SEA mode:

- Walks dependencies like traditional mode, but **skips V8 bytecode compilation and ESM-to-CJS transforms** — files stay as-is
- Bundles all files into a **single archive blob** with offset-based zero-copy access at runtime
- Supports **worker threads** (VFS hooks are automatically injected into `/snapshot/...` workers)
- **Native addon extraction** works the same as traditional mode
- **ESM entry points** (`"type": "module"`) work on every supported target (Node >= 22), **including entrypoints that use top-level await**. ESM entries are dispatched via `vm.Script` + `USE_MAIN_CONTEXT_DEFAULT_LOADER`, which routes dynamic `import()` through the default ESM loader — no Node-version split, no build-time warning. CJS entries go through `Module.runMain()`.
- `seaConfig.useSnapshot` is not supported in enhanced SEA mode (incompatible with the VFS bootstrap); set it to `false` or omit it. `useCodeCache` is forwarded as-is.
- Runtime diagnostics via `DEBUG_PKG` / `SIZE_LIMIT_PKG` / `FOLDER_LIMIT_PKG` work the same as in traditional mode, but only when the binary was built with `--debug` (release builds cannot be coerced into dumping the VFS tree).
- Migration path to **`node:vfs`** when it lands in Node.js core.

## Trade-offs vs Standard mode

Enhanced SEA builds faster and uses **official Node.js APIs**, but stores source code in plaintext (no bytecode protection) and does not support compression.

For a full comparison and the roadmap for eliminating patched Node.js entirely, see **[SEA vs Standard](/guide/sea-vs-standard)**.
