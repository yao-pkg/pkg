# pkg Architecture: Traditional Mode vs Enhanced SEA Mode

This document describes how `pkg` packages Node.js applications into standalone executables, covering both the traditional binary-patching approach and the new SEA (Single Executable Application) mode with VFS support.

## Table of Contents

- [Overview](#overview)
- [Traditional Mode](#traditional-mode)
  - [Build Pipeline](#build-pipeline)
  - [Binary Format](#binary-format)
  - [Runtime Bootstrap](#runtime-bootstrap)
- [Enhanced SEA Mode](#enhanced-sea-mode)
  - [Build Pipeline](#sea-build-pipeline)
  - [Binary Format](#sea-binary-format)
  - [Runtime Bootstrap](#sea-runtime-bootstrap)
  - [VFS Provider Architecture](#vfs-provider-architecture)
- [Shared Runtime Code](#shared-runtime-code)
- [Performance Comparison](#performance-comparison)
- [Code Protection Comparison](#code-protection-comparison)
- [When to Use Each Mode](#when-to-use-each-mode)
- [Node.js Ecosystem Dependencies](#nodejs-ecosystem-dependencies)

---

## Overview

`pkg` supports two packaging strategies, selected via the `--sea` flag:

```
pkg .                          # Traditional mode (default)
pkg . --sea                    # Enhanced SEA mode (Node >= 22 with package.json)
pkg single-file.js --sea       # Simple SEA mode (any single .js file)
```

| Aspect        | Traditional          | Enhanced SEA        | Simple SEA          |
| ------------- | -------------------- | ------------------- | ------------------- |
| Walker        | Yes                  | Yes (seaMode)       | No                  |
| VFS           | Custom binary format | @platformatic/vfs   | None                |
| Bytecode      | V8 compiled          | No (source as-is)   | No                  |
| ESM transform | ESM to CJS           | No (native ESM)     | No                  |
| Node.js API   | Binary patching      | Official `node:sea` | Official `node:sea` |
| Min Node      | 22 (pkg runtime)     | 22 (target)         | 20 (target)         |

---

## Traditional Mode

### Build Pipeline

```
CLI (lib/index.ts)
  │
  ├─ Parse targets (node22-linux-x64, etc.)
  ├─ Fetch pre-compiled Node.js binaries (via @yao-pkg/pkg-fetch)
  │
  ├─ Walker (lib/walker.ts)
  │   ├─ Parse entry file with Babel → find require/import calls
  │   ├─ Recursively resolve dependencies (lib/follow.ts, lib/resolver.ts)
  │   ├─ Transform ESM → CJS (lib/esm-transformer.ts)
  │   ├─ Compile JS to V8 bytecode via fabricator (lib/fabricator.ts)
  │   └─ Collect: STORE_BLOB, STORE_CONTENT, STORE_LINKS, STORE_STAT
  │
  ├─ Refiner (lib/refiner.ts)
  │   ├─ Purge empty top-level directories
  │   └─ Denominate paths (strip common prefix)
  │
  ├─ Packer (lib/packer.ts)
  │   ├─ Serialize file records into "stripes" (snap path + store + data)
  │   ├─ Wrap bootstrap.js with injected parameters:
  │   │     REQUIRE_COMMON, REQUIRE_SHARED, VIRTUAL_FILESYSTEM,
  │   │     DEFAULT_ENTRYPOINT, SYMLINKS, DICT, DOCOMPRESS
  │   └─ Return { prelude, entrypoint, stripes }
  │
  └─ Producer (lib/producer.ts)
      ├─ Open Node.js binary
      ├─ Find placeholders (PAYLOAD_POSITION, PAYLOAD_SIZE, BAKERY, etc.)
      ├─ Stream stripes into payload section
      ├─ Apply compression (Brotli/GZip) per stripe
      ├─ Build VFS dictionary for path compression
      ├─ Inject byte offsets into placeholders
      └─ Write final executable
```

### Binary Format

The traditional executable has this layout:

```
┌────────────────────────────────┐
│ Node.js binary (unmodified)    │  ← Original executable
│ with placeholder markers:      │
│   // BAKERY //                 │  ← Node.js CLI options
│   // PAYLOAD_POSITION //       │  ← Byte offset of payload
│   // PAYLOAD_SIZE //           │  ← Byte length of payload
│   // PRELUDE_POSITION //       │  ← Byte offset of prelude
│   // PRELUDE_SIZE //           │  ← Byte length of prelude
├────────────────────────────────┤
│ Payload section:               │
│   ┌────────────────────────┐   │
│   │ Prelude (bootstrap.js) │   │  ← Runtime bootstrap code
│   ├────────────────────────┤   │
│   │ Stripe: /app/index.js  │   │  ← V8 bytecode (STORE_BLOB)
│   │ Stripe: /app/lib.js    │   │  ← Source code (STORE_CONTENT)
│   │ Stripe: /app/data.json │   │  ← Asset content
│   │ Stripe: /app/          │   │  ← Dir listing (STORE_LINKS)
│   │ ...                    │   │
│   ├────────────────────────┤   │
│   │ VFS dictionary (JSON)  │   │  ← Maps paths → [offset, size]
│   └────────────────────────┘   │
└────────────────────────────────┘
```

Each file is stored with one or more store types:

| Store           | Value | Content           | Purpose                                         |
| --------------- | ----- | ----------------- | ----------------------------------------------- |
| `STORE_BLOB`    | 0     | V8 bytecode       | Compiled JS (source can be stripped)            |
| `STORE_CONTENT` | 1     | Raw source/binary | JS source, JSON, assets, .node files            |
| `STORE_LINKS`   | 2     | JSON array        | Directory entry names for `readdir`             |
| `STORE_STAT`    | 3     | JSON object       | File metadata (size, mode, isFile, isDirectory) |

### Runtime Bootstrap

`prelude/bootstrap.js` (1970 lines) executes before user code. It:

1. **Sets up entrypoint** — Reads `DEFAULT_ENTRYPOINT` from injected parameters, sets `process.argv[1]`
2. **Initializes VFS** — Builds in-memory lookup from `VIRTUAL_FILESYSTEM` dictionary with optional path compression via `DICT`
3. **Patches `fs` module** — Intercepts 20+ `fs` functions (`readFileSync`, `readFile`, `statSync`, `stat`, `readdirSync`, `readdir`, `existsSync`, `exists`, `accessSync`, `access`, `realpathSync`, `realpath`, `createReadStream`, `open`, `read`, `close`, etc.). Each patched function checks if the path is inside `/snapshot/` — if yes, reads from the VFS payload; if no, falls through to the real `fs`
4. **Patches `Module` system** — Custom `_resolveFilename` and `_compile` that load modules from the VFS. Bytecode modules are executed via `vm.Script` with `cachedData` (the V8 bytecode) and `sourceless: true`
5. **Patches `child_process`** — Via `REQUIRE_SHARED.patchChildProcess()`. Rewrites spawn/exec calls so that spawning `node` or the entrypoint correctly uses `process.execPath`
6. **Patches `process.dlopen`** — Via `REQUIRE_SHARED.patchDlopen()`. Extracts `.node` files from VFS to `~/.cache/pkg/<sha256>/` before loading
7. **Sets up `process.pkg`** — Via `REQUIRE_SHARED.setupProcessPkg()`. Provides `process.pkg.entrypoint`, `process.pkg.path.resolve()`, `process.pkg.mount()`

The payload is read at runtime via file descriptor operations on the executable itself:

```javascript
// bootstrap.js — reads payload from the running executable
fs.readSync(EXECPATH_FD, buffer, offset, length, PAYLOAD_POSITION + position);
```

---

## Enhanced SEA Mode

### SEA Build Pipeline

```
CLI (lib/index.ts)
  │
  ├─ Detect: has package.json + target Node >= 22 → enhanced mode
  │
  ├─ Walker (lib/walker.ts, seaMode: true)
  │   ├─ Parse entry file with Babel → find require/import calls
  │   ├─ Recursively resolve dependencies
  │   ├─ SKIP: ESM → CJS transformation (files stay native ESM)
  │   ├─ SKIP: V8 bytecode compilation (no fabricator)
  │   └─ Collect: STORE_CONTENT only (+ STORE_LINKS, STORE_STAT)
  │
  ├─ Refiner (lib/refiner.ts)
  │   └─ Same as traditional (path compression, empty dir pruning)
  │
  ├─ SEA Asset Generator (lib/sea-assets.ts)
  │   ├─ Map each STORE_CONTENT → SEA asset entry (snap_path → disk_path)
  │   ├─ Build __pkg_manifest__.json:
  │   │     { entrypoint, directories, stats, symlinks }
  │   └─ Write modified files (patches) to temp dir
  │
  └─ SEA Orchestrator (lib/sea.ts → seaEnhanced())
      ├─ Copy pre-bundled sea-bootstrap.bundle.js to tmpDir
      ├─ Build sea-config.json:
      │     { main, output, assets: { __pkg_manifest__, ...files } }
      ├─ Generate blob:
      │     Node 25.5+:  node --build-sea sea-config.json
      │     Node 22-24:  node --experimental-sea-config sea-config.json
      ├─ For each target:
      │     1. Download Node.js binary (getNodejsExecutable)
      │     2. Inject blob via postject (bake)
      │     3. Sign macOS if needed (signMacOSIfNeeded)
      └─ Cleanup tmpDir
```

### SEA Binary Format

The SEA executable uses the official Node.js resource format:

```
┌──────────────────────────────────┐
│ Node.js binary                   │
│ with NODE_SEA_FUSE activated     │  ← Sentinel fuse flipped
├──────────────────────────────────┤
│ NODE_SEA_BLOB resource:          │  ← Injected via postject
│   ┌──────────────────────────┐   │
│   │ main: sea-bootstrap.js   │   │  ← Bundled bootstrap + VFS polyfill
│   ├──────────────────────────┤   │
│   │ Asset: __pkg_manifest__  │   │  ← JSON manifest (dirs, stats, symlinks)
│   │ Asset: /app/index.js     │   │  ← Source code (plaintext)
│   │ Asset: /app/lib/util.js  │   │  ← Source code
│   │ Asset: /app/config.json  │   │  ← JSON asset
│   │ ...                      │   │
│   └──────────────────────────┘   │
└──────────────────────────────────┘
```

The resource is embedded using OS-native formats:

- **Linux**: ELF notes section
- **Windows**: PE `.rsrc` section
- **macOS**: Mach-O `NODE_SEA` segment

### SEA Runtime Bootstrap

`prelude/sea-bootstrap.js` (187 lines, bundled with `@platformatic/vfs` into 151kb `sea-bootstrap.bundle.js`) executes as the SEA `main` entry:

1. **Load manifest** — `JSON.parse(sea.getAsset('__pkg_manifest__', 'utf8'))`
2. **Initialize VFS** — Creates `SEAProvider` (extends `MemoryProvider`), mounts at `/snapshot` with overlay mode
3. **Normalize paths** — On Windows, converts POSIX `/snapshot/...` paths in manifest to `C:\snapshot\...`
4. **Apply shared patches** — Calls `patchDlopen()`, `patchChildProcess()`, `setupProcessPkg()` from `bootstrap-shared.js`
5. **Run entrypoint** — Sets `process.argv[1]`, calls `Module.runMain()`

The VFS polyfill (`@platformatic/vfs`) handles all `fs` and `fs/promises` patching automatically when `mount()` is called — intercepting 164+ functions including `readFile`, `readFileSync`, `stat`, `readdir`, `access`, `realpath`, `createReadStream`, `watch`, `open`, and their promise-based equivalents. It also hooks into the Node.js module resolution system for `require()` and `import`.

### VFS Provider Architecture

```
┌─────────────────────────────────────────────────┐
│ User code: fs.readFileSync('/snapshot/app/x.js') │
└──────────────────────┬──────────────────────────┘
                       │
         ┌─────────────▼──────────────┐
         │ @platformatic/vfs          │
         │ (mounted at /snapshot,     │
         │  overlay: true)            │
         │                            │
         │ Strips prefix: /app/x.js   │
         │ Calls provider method      │
         └─────────────┬──────────────┘
                       │
         ┌─────────────▼──────────────┐
         │ SEAProvider                 │
         │ extends MemoryProvider      │
         │                            │
         │ readFileSync('/app/x.js')  │
         │   → _ensureLoaded()        │
         │   → sea.getRawAsset(key)   │  ← Zero-copy from executable memory
         │   → super.writeFileSync()  │  ← Cache in MemoryProvider
         │   → super.readFileSync()   │  ← Return cached content
         └────────────────────────────┘
```

The `SEAProvider` implements lazy loading:

| Method               | Behavior                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `readFileSync(path)` | Resolve symlinks, lazy-load from SEA asset on first access, delegate to `MemoryProvider` |
| `statSync(path)`     | Return metadata from manifest; trigger lazy-load for files                               |
| `readdirSync(path)`  | Return directory entries from manifest                                                   |
| `existsSync(path)`   | Check manifest symlinks and stats                                                        |
| `readlinkSync(path)` | Return symlink target from manifest                                                      |

Assets are loaded lazily via `sea.getRawAsset(key)` which returns a zero-copy `ArrayBuffer` reference to the executable's memory-mapped region. The buffer is copied once into the `MemoryProvider` cache on first access.

---

## Shared Runtime Code

`prelude/bootstrap-shared.js` (255 lines) contains runtime patches used by both bootstraps:

### Injection Mechanisms

- **Traditional bootstrap**: The packer (`lib/packer.ts`) wraps the bootstrap in an IIFE that receives `REQUIRE_SHARED` as a parameter. The shared module is executed as an inline IIFE:

  ```javascript
  (function () {
    var module = { exports: {} };
    /* bootstrap-shared.js content */
    return module.exports;
  })();
  ```

- **SEA bootstrap**: `require('./bootstrap-shared')` is resolved at build time by esbuild and bundled into `sea-bootstrap.bundle.js`.

### Shared Functions

**`patchDlopen(insideSnapshot)`** — Patches `process.dlopen` to extract native `.node` addons from the virtual filesystem to a cache directory before loading:

```
.node file requested → inside snapshot?
  ├─ No → call original dlopen
  └─ Yes → read content via fs.readFileSync (intercepted by VFS)
       → SHA256 hash → cache dir: ~/.cache/pkg/<hash>/
       → in node_modules? → fs.cpSync entire package folder (fix #1075)
       → standalone?     → fs.copyFileSync single file
       → call original dlopen with extracted path
```

**`patchChildProcess(entrypoint)`** — Wraps all 6 `child_process` methods (`spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec`, `execSync`) to:

- Set `PKG_EXECPATH` env var so child processes can detect they were spawned from a packaged app
- Replace references to `node`, `process.argv[0]`, or the entrypoint with `process.execPath` (the actual executable)

**`setupProcessPkg(entrypoint)`** — Creates the `process.pkg` compatibility object with `entrypoint`, `defaultEntrypoint`, and `path.resolve()`.

---

## Performance Comparison

| Aspect               | Traditional `pkg`                                                                                                                              | Enhanced SEA                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Startup time**     | V8 bytecode loads faster than parsing source — bytecode is pre-compiled. `vm.Script` with `cachedData` skips the parsing phase                 | `useCodeCache: true` provides similar optimization. Without it, every launch re-parses source from scratch                                                   |
| **Memory footprint** | Payload accessed via file descriptor reads on demand at computed offsets. Files loaded only when accessed                                      | `sea.getRawAsset()` returns a zero-copy `ArrayBuffer` reference to the executable's mapped memory. With lazy `SEAProvider`, only accessed files are buffered |
| **Executable size**  | Brotli/GZip compression reduces payload by 60-80%. Dictionary path compression adds 5-15% reduction                                            | SEA assets are stored uncompressed. Executable size will be larger for the same project                                                                      |
| **Build time**       | V8 bytecode compilation spawns a Node.js process per file via fabricator. Cross-arch bytecode needs QEMU/Rosetta. Expensive for large projects | No bytecode step. Pipeline: walk deps, write assets, generate blob, inject. Significantly faster                                                             |
| **Module loading**   | Custom `require` implementation in bootstrap. Each module loaded from VFS via binary offset reads. Synchronous only                            | VFS polyfill patches `require`/`import` at module resolution level. 164+ fs functions intercepted. ESM module hooks supported natively                       |
| **Native addons**    | Extracted to `~/.cache/pkg/<hash>/` on first load, SHA256-verified, persisted across runs                                                      | Same extraction strategy via shared `patchDlopen()`. Uses `fs.cpSync` for package folder copying                                                             |

---

## Code Protection Comparison

| Aspect                  | Traditional `pkg`                                                                                                        | Enhanced SEA                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Source code storage** | Can be fully stripped — `STORE_BLOB` with `sourceless: true` stores only V8 bytecode, no source recoverable              | Source code stored as SEA assets in plaintext. `useCodeCache: true` adds a code cache alongside source but does NOT strip it             |
| **Reverse engineering** | V8 bytecode requires specialized tools (`v8-decompile`) to reverse. Not trivially readable                               | Standard text assets extractable from executable resource section using `readelf`/`xxd` or by searching for the `NODE_SEA_FUSE` sentinel |
| **Binary format**       | Custom VFS format with offset-based access, optional Brotli/GZip compression, base36 dictionary path compression         | Standard OS resource format (PE `.rsrc`, ELF notes, Mach-O segments) — well-documented, easier to parse                                  |
| **Payload location**    | Custom byte offsets injected via placeholder replacement. Requires understanding pkg's specific binary layout to extract | Standard `NODE_SEA_BLOB` resource name. `postject` uses OS-native resource embedding                                                     |
| **Runtime access**      | Accessed via file descriptor reads at computed offsets. No standard tooling to extract                                   | Accessed via `sea.getAsset(key)` — official Node.js API, assets are first-class                                                          |

**Key takeaway**: Traditional `pkg` offers significantly stronger code protection through V8 bytecode compilation with source stripping. SEA mode stores source code in plaintext within the executable. This is a fundamental limitation of the Node.js SEA design — there is no `sourceless` equivalent.

For users who require code protection with SEA mode:

1. Pre-process code through an obfuscator (e.g., `javascript-obfuscator`) before packaging
2. Use `useCodeCache: true` for marginal protection (source still present but code cache adds a layer)
3. Use traditional `pkg` mode instead

---

## When to Use Each Mode

| Use Case                                        | Recommended Mode                                |
| ----------------------------------------------- | ----------------------------------------------- |
| Code protection / IP-sensitive distribution     | Traditional `pkg` (bytecode + source stripping) |
| Fast build iteration during development         | Enhanced SEA                                    |
| ESM-native projects                             | Enhanced SEA (no CJS transform needed)          |
| Minimum executable size                         | Traditional `pkg` (compression support)         |
| Maximum Node.js compatibility / future-proofing | Enhanced SEA (uses official Node.js APIs)       |
| Cross-platform builds from single host          | Traditional `pkg` (platform-independent VFS)    |
| Simple single-file scripts                      | Simple SEA (no walker overhead)                 |

---

## Node.js Ecosystem Dependencies

### Current (April 2026)

| Dependency             | Purpose                                                       | Status                                                                                 |
| ---------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `node:sea` API         | Asset storage and retrieval in SEA executables                | Stable, Node 20+                                                                       |
| `@platformatic/vfs`    | VFS polyfill — patches `fs`, `fs/promises`, and module loader | Published, Node 22+, maintained by Matteo Collina                                      |
| `postject`             | Injects `NODE_SEA_BLOB` resource into executables             | Stable, used by Node.js project                                                        |
| `--build-sea` flag     | Single-step SEA blob generation                               | Node 25.5+                                                                             |
| `mainFormat: "module"` | ESM entry point in SEA config                                 | Node 25.7+ (merged via [nodejs/node#61813](https://github.com/nodejs/node/pull/61813)) |

### Future

| Dependency | Purpose                           | Status                                                                              |
| ---------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `node:vfs` | Native VFS module in Node.js core | Open PR [nodejs/node#61478](https://github.com/nodejs/node/pull/61478), 8 approvals |

When `node:vfs` lands in Node.js core, `@platformatic/vfs` will be deprecated. The SEA bootstrap already includes a migration path:

```javascript
var vfsModule;
try {
  vfsModule = require('node:vfs'); // native, when available
} catch (_) {
  vfsModule = require('@platformatic/vfs'); // polyfill fallback
}
```

With `node:vfs` and `"useVfs": true` in the SEA config, assets will be auto-mounted and the bootstrap will simplify significantly — the VFS provider and manual mounting will no longer be needed.

---

## File Reference

| File                          | Lines | Purpose                                                     |
| ----------------------------- | ----- | ----------------------------------------------------------- |
| `prelude/bootstrap.js`        | ~1970 | Traditional runtime bootstrap (fs/module/process patching)  |
| `prelude/bootstrap-shared.js` | ~255  | Shared runtime patches (dlopen, child_process, process.pkg) |
| `prelude/sea-bootstrap.js`    | ~187  | SEA runtime bootstrap (VFS setup, lazy SEAProvider)         |
| `lib/index.ts`                | ~726  | CLI entry point, mode routing                               |
| `lib/walker.ts`               | ~1304 | Dependency walker (with seaMode support)                    |
| `lib/packer.ts`               | ~194  | Serializes walker output into stripes + prelude wrapper     |
| `lib/producer.ts`             | ~601  | Assembles final binary (payload injection, compression)     |
| `lib/sea.ts`                  | ~561  | SEA orchestrator (seaEnhanced + simple sea)                 |
| `lib/sea-assets.ts`           | ~105  | Generates SEA asset map + manifest JSON                     |
| `lib/fabricator.ts`           | ~173  | V8 bytecode compilation (traditional mode only)             |
| `lib/esm-transformer.ts`      | ~434  | ESM to CJS transformation (traditional mode only)           |
| `lib/refiner.ts`              | ~110  | Path compression, empty directory pruning                   |
| `lib/common.ts`               | ~369  | Path normalization, snapshot helpers, store constants       |
