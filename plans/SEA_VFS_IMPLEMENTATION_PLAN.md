# Enhanced SEA Support with Walker Integration and VFS

> **Issue**: [yao-pkg/pkg#204](https://github.com/yao-pkg/pkg/issues/204)
> **Date**: 2026-04-07
> **Status**: Draft

## Table of Contents

- [Context](#context)
- [Performance and Code Protection Analysis](#performance-and-code-protection-analysis)
- [Architecture Decisions](#architecture-decisions)
- [Implementation Plan](#implementation-plan)
- [Code Reuse and DRY Strategy](#code-reuse-and-dry-strategy)
- [Risks and Mitigations](#risks-and-mitigations)
- [Verification](#verification)

---

## Context

### Problem

The current `--sea` flag (`lib/sea.ts`) completely bypasses the walker/packer/producer pipeline. It takes a single pre-bundled `.js` file, creates a minimal `sea-config.json`, generates a blob via `node --experimental-sea-config`, and injects it with `postject`. There is:

- **No dependency walking** — user must pre-bundle everything with esbuild/webpack
- **No VFS** — no `fs.readFileSync` for packaged files, no `readdir`, no `stat`
- **No native addon handling** — `.node` files cannot be loaded
- **No ESM support** — must pre-transpile to CJS
- **No asset bundling** — JSON, images, templates must be manually inlined

### Goal

Evolve `--sea` into a full pipeline that reuses the existing walker for dependency discovery, maps all files as SEA assets, and provides a runtime bootstrap using VFS to create a transparent virtual filesystem — keeping the developer experience identical to traditional `pkg`.

### Node.js Ecosystem State

| Feature                                                    | Status    | Version             | Notes                                                               |
| ---------------------------------------------------------- | --------- | ------------------- | ------------------------------------------------------------------- |
| `node:sea` API (`getAsset`, `getRawAsset`, `getAssetKeys`) | Stable    | Node 20+            | Asset storage and retrieval                                         |
| SEA `assets` field in config                               | Stable    | Node 21.7+ / 20.12+ | Key-value asset embedding                                           |
| `--build-sea` (single-step build)                          | Stable    | Node 25.5+          | Replaces `--experimental-sea-config` + `postject`                   |
| `mainFormat: "module"` (ESM entry)                         | Merged    | Node 25.7+          | [PR #61813](https://github.com/nodejs/node/pull/61813)              |
| `node:vfs` (built-in VFS)                                  | Open PR   | TBD                 | [PR #61478](https://github.com/nodejs/node/pull/61478), 8 approvals |
| `@platformatic/vfs` (polyfill)                             | Published | Node 22+            | Same author as PR #61478, will deprecate when core lands            |

---

## Performance and Code Protection Analysis

### Code Protection Comparison

| Aspect                  | Traditional `pkg` (default)                                                                                                                      | Enhanced SEA (proposed)                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Source code storage** | Can be fully stripped — `STORE_BLOB` with `sourceless: true` stores only V8 bytecode, no source recoverable                                      | Source code stored as SEA assets in plaintext. `useCodeCache: true` adds a code cache alongside source but does NOT strip it             |
| **Reverse engineering** | V8 bytecode requires specialized tools (`v8-decompile`) to reverse. Not trivially readable                                                       | Standard text assets extractable from executable resource section using `readelf`/`xxd` or by searching for the `NODE_SEA_FUSE` sentinel |
| **Binary format**       | Custom VFS format with offset-based access, optional Brotli/GZip compression, base36 dictionary path compression                                 | Standard OS resource format (PE `.rsrc` on Windows, ELF notes on Linux, Mach-O segments on macOS) — well-documented, easier to parse     |
| **Payload location**    | Custom byte offsets injected via placeholder replacement (`PAYLOAD_POSITION`, `PAYLOAD_SIZE`). Requires understanding the specific binary layout | Standard `NODE_SEA_BLOB` resource name. `postject` uses OS-native resource embedding                                                     |
| **Runtime access**      | Accessed via file descriptor reads at computed offsets (`prelude/bootstrap.js:425-451`). No standard tooling to extract                          | Accessed via `sea.getAsset(key)` — official API, assets are first-class                                                                  |

**Key takeaway**: Traditional `pkg` offers significantly stronger code protection through V8 bytecode compilation with source stripping. SEA mode stores source code in plaintext within the executable. This is a fundamental limitation of the Node.js SEA design — there is no `sourceless` equivalent. Users who require code obfuscation should:

1. Continue using the traditional `pkg` mode, OR
2. Pre-process their code through an obfuscator (e.g., `javascript-obfuscator`) before SEA packaging, OR
3. Use `useCodeCache: true` for marginal protection (source still present, but code cache makes direct extraction slightly harder)

### Performance Comparison

| Aspect               | Traditional `pkg`                                                                                                                                         | Enhanced SEA                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Startup time**     | V8 bytecode loads faster than parsing source — bytecode is pre-compiled. `vm.Script` with `cachedData` skips parsing phase (`bootstrap.js:1899-1918`)     | `useCodeCache: true` provides similar optimization. First run parses source, subsequent runs (within the same binary) use cached compilation. Without it, every launch re-parses from source |
| **Memory footprint** | Payload accessed via file descriptor reads on demand (`readPayloadSync` at computed offsets). Files loaded only when accessed                             | SEA `getRawAsset()` returns a zero-copy `ArrayBuffer` reference to the executable's mapped memory — very efficient. With custom `SEAProvider`, memory usage is comparable                    |
| **Executable size**  | Brotli/GZip compression available — can reduce payload by 60-80%. Dictionary path compression adds 5-15% reduction                                        | SEA assets are stored uncompressed. Executable size will be larger for the same project. Compression would require build-time compression + runtime decompression in bootstrap               |
| **Build time**       | V8 bytecode compilation requires spawning a Node.js process per file via fabricator. Cross-arch bytecode needs QEMU/Rosetta. Expensive for large projects | No bytecode compilation step. Build is: walk deps + write assets + generate blob + inject. Significantly faster for large projects                                                           |
| **Module loading**   | Custom `require` implementation in bootstrap. Each module loaded from VFS via offset reads. Synchronous                                                   | VFS polyfill patches `require`/`import` at module resolution level. `@platformatic/vfs` handles 164+ fs functions. Module hooks support ESM natively                                         |
| **Native addons**    | Extracted to `~/.cache/pkg/` on first load, SHA256-verified, persisted across runs (`bootstrap.js:155-242`)                                               | Same approach needed — extract from VFS to temp dir, load via `process.dlopen`. Can reuse identical caching strategy                                                                         |

**Key takeaway**: SEA mode trades code protection for build speed and Node.js compatibility. The zero-copy asset access via `getRawAsset()` provides excellent runtime memory efficiency. Build times are substantially faster since there is no bytecode compilation step. However, executable size will be larger without compression support.

### When to Use Each Mode

| Use Case                                        | Recommended Mode                                |
| ----------------------------------------------- | ----------------------------------------------- |
| Code protection / IP-sensitive distribution     | Traditional `pkg` (bytecode + source stripping) |
| Fast build iteration during development         | Enhanced SEA                                    |
| ESM-native projects                             | Enhanced SEA (no CJS transform needed)          |
| Minimum executable size                         | Traditional `pkg` (compression support)         |
| Maximum Node.js compatibility / future-proofing | Enhanced SEA (uses official APIs)               |
| Cross-platform builds from single host          | Traditional `pkg` (platform-independent VFS)    |

---

## Architecture Decisions

### D1: Use `@platformatic/vfs` as VFS runtime

Building a custom layer that patches 164+ fs functions + module resolution would duplicate `@platformatic/vfs`. The polyfill is maintained by the same author as `node:vfs` PR #61478. Migration path when `node:vfs` lands in core:

```javascript
let vfs;
try {
  vfs = require('node:vfs');
} catch {
  vfs = require('@platformatic/vfs');
}
```

### D2: Bundle VFS polyfill into self-contained SEA bootstrap at build time

SEA `main` must be self-contained. Use `esbuild` (already a project dependency) to bundle `prelude/sea-bootstrap.js` + `@platformatic/vfs` into a single file at `pkg` build time.

### D3: Skip ESM-to-CJS transform and V8 bytecode in SEA mode

SEA on Node 25.7+ supports ESM natively (`mainFormat: "module"`). On Node 22-24, the VFS polyfill's module hooks handle ESM. V8 bytecode is unnecessary — SEA has `useCodeCache`. The walker gets a `seaMode` flag that disables these steps.

### D4: Store directory metadata as a JSON manifest asset

SEA assets are flat key-value pairs. A `__pkg_manifest__.json` asset contains directory tree structure, symlinks, stat info, and native addon list. The bootstrap reads this for `readdir`, `stat`, etc.

### D5: Create a custom `SEAProvider` for lazy asset loading

Instead of loading all SEA assets into `MemoryProvider` at startup (high memory), create a `SEAProvider` that wraps `sea.getRawAsset()` lazily. Zero-copy. Directory listings and stat come from the manifest.

### D6: Backward compatibility — simple `--sea` mode preserved

Enhanced mode activates when `--sea` is used with a package.json/directory input AND target Node >= 22. Plain `.js` file input or Node < 22 targets fall back to current simple behavior.

### D7: Minimum target Node 22+ for enhanced SEA

`@platformatic/vfs` requires Node >= 22. Node 20 reaches EOL April 2026.

---

## Implementation Plan

### Step 1: Dependencies and build infrastructure

**Files to modify:**

- `package.json`

**Changes:**

1. Add `@platformatic/vfs` to `dependencies`
2. Add `build:sea-bootstrap` script:
   ```json
   "build:sea-bootstrap": "esbuild prelude/sea-bootstrap.js --bundle --platform=node --target=node22 --outfile=prelude/sea-bootstrap.bundle.js --external:node:sea --external:node:fs --external:node:path --external:node:os --external:node:crypto --external:node:module --external:node:vfs"
   ```
3. Integrate into the main `build` script so it runs alongside TypeScript compilation
4. Add `prelude/sea-bootstrap.bundle.js` to `.gitignore` (generated artifact)

---

### Step 2: Walker SEA mode

**File to modify:** `lib/walker.ts`

Add `seaMode?: boolean` to `WalkerParams` interface. When true:

1. **`appendBlobOrContent`** — always use `STORE_CONTENT` instead of `STORE_BLOB`. No bytecode.
2. **`step_STORE_ANY`** — skip ESM-to-CJS transformation. Files stay in original format.
3. **Package.json processing** — do NOT rewrite `"type": "module"` to `"type": "commonjs"`. ESM packages stay ESM.
4. All dependency discovery, `.node` detection, symlinks, `pkg.assets`, `pkg.scripts` work unchanged.

**DRY note**: The walker's core traversal logic, `stepDetect`, `follow`, and resolution remain completely untouched. Only the storage/transform decisions change based on a flag.

---

### Step 3: SEA asset map generator

**New file:** `lib/sea-assets.ts`

Transforms walker output → SEA config assets + manifest.

```typescript
import { FileRecords, SymLinks } from './types';
import { STORE_CONTENT, STORE_LINKS, STORE_STAT } from './common';

export interface SeaManifest {
  entrypoint: string;
  directories: Record<string, string[]>;
  stats: Record<
    string,
    { size: number; isFile: boolean; isDirectory: boolean }
  >;
  symlinks: Record<string, string>;
  nativeAddons: string[];
}

export interface SeaAssetsResult {
  assets: Record<string, string>; // snapshot_path -> disk_path
  manifestPath: string; // path to __pkg_manifest__.json
}

export async function generateSeaAssets(
  records: FileRecords,
  entrypoint: string,
  symLinks: SymLinks,
  tmpDir: string,
): Promise<SeaAssetsResult>;
```

**Logic:**

1. Iterate `records`. For each entry with `STORE_CONTENT`:
   - If `record.body` was modified (patches, rewrites) → write to temp file, point asset there
   - Otherwise → point directly to `record.file` on disk
   - Key = snapshot path (reuse `snapshotify` from `lib/common.ts:192`)
2. Build manifest from `STORE_LINKS` (directory entries) and `STORE_STAT` (metadata)
3. Identify native addons (files ending in `.node`) → `manifest.nativeAddons`
4. Write manifest to `tmpDir/__pkg_manifest__.json`

**DRY note**: Reuses `snapshotify`, `normalizePath`, and `insideSnapshot` from `lib/common.ts`. Does NOT duplicate any path logic.

---

### Step 4: SEA bootstrap script

**New file:** `prelude/sea-bootstrap.js`

This becomes the SEA `main` entry. Bundled with `@platformatic/vfs` at build time.

**Execution flow:**

```
1. Read __pkg_manifest__.json from SEA assets
2. Create SEAProvider (custom, wraps sea.getRawAsset lazily)
3. Create VirtualFileSystem, mount at /snapshot with overlay: true
4. Patch process.dlopen for native addon extraction
5. Set process.pkg compatibility
6. Set process.argv[1] = entrypoint
7. Run entrypoint via Module.runMain()
```

**Custom SEAProvider** (defined within sea-bootstrap.js):

```javascript
class SEAProvider {
  constructor(manifest) {
    this.manifest = manifest;
  }

  readFileSync(snapshotPath) {
    return Buffer.from(sea.getRawAsset(snapshotPath)); // zero-copy from executable memory
  }

  statSync(snapshotPath) {
    const s = this.manifest.stats[snapshotPath];
    if (!s)
      throw Object.assign(new Error(`ENOENT: ${snapshotPath}`), {
        code: 'ENOENT',
      });
    return s;
  }

  readdirSync(snapshotPath) {
    const entries = this.manifest.directories[snapshotPath];
    if (!entries)
      throw Object.assign(new Error(`ENOENT: ${snapshotPath}`), {
        code: 'ENOENT',
      });
    return entries;
  }

  existsSync(snapshotPath) {
    return snapshotPath in this.manifest.stats;
  }
}
```

**Native addon extraction** — reuses the same strategy as `prelude/bootstrap.js:155-242`:

- Extract `.node` from VFS to `~/.cache/pkg/<sha256>/`
- SHA256 verification to skip re-extraction
- Sync extraction (required by `process.dlopen`)

**DRY note**: The native addon extraction logic from `bootstrap.js` should be extracted into a shared utility that both bootstraps can reference. During the esbuild bundle step, the shared code gets inlined into each bootstrap independently.

**`node:vfs` migration path**: When `node:vfs` lands AND the SEA config supports `"useVfs": true`, the entire bootstrap simplifies to just running the entrypoint — Node handles VFS transparently.

---

### Step 5: Enhanced SEA orchestrator

**File to modify:** `lib/sea.ts`

Refactor the module to export both simple and enhanced modes.

**New exports:**

```typescript
// Keep existing function as-is, rename internally
export { sea as seaSimple };

// New enhanced function
export async function seaEnhanced(
  entrypoint: string,
  opts: SeaEnhancedOptions,
): Promise<void>;
```

**`seaEnhanced` flow:**

1. Run walker with `{ seaMode: true }`
2. Run refiner (path compression, empty dir pruning) — reuse `lib/refiner.ts`
3. Generate SEA assets via `generateSeaAssets` (Step 3)
4. Copy pre-bundled bootstrap to tmpDir
5. Build `sea-config.json`:
   ```json
   {
     "main": "<tmpDir>/sea-main.js",
     "output": "<tmpDir>/sea-prep.blob",
     "disableExperimentalSEAWarning": true,
     "useCodeCache": false,
     "useSnapshot": false,
     "assets": {
       "__pkg_manifest__": "<tmpDir>/__pkg_manifest__.json",
       "/snapshot/myapp/index.js": "/real/path/to/index.js",
       ...
     }
   }
   ```
6. Generate blob — detect Node version:
   - Node >= 25.5: `node --build-sea sea-config.json`
   - Node < 25.5: `node --experimental-sea-config sea-config.json`
7. For each target: download Node binary (reuse `getNodejsExecutable`), inject blob (reuse `bake`)
8. Sign macOS binaries if `--signature` (reuse existing signing logic)
9. Cleanup tmpDir

**DRY note**: `getNodejsExecutable`, `bake`, `downloadFile`, `extract`, `verifyChecksum`, `getNodeVersion`, `getNodeOs`, `getNodeArch` — ALL reused as-is. No duplication.

---

### Step 6: CLI integration

**File to modify:** `lib/index.ts` (around line 531)

Replace the current `--sea` block:

```typescript
if (argv.sea) {
  const targetNodeMajor = parseInt(
    targets[0].nodeRange.replace('node', ''),
    10,
  );

  if ((inputJson || configJson) && targetNodeMajor >= 22) {
    // Enhanced SEA: full walker pipeline
    const marker: Marker = configJson
      ? { config: configJson, base: path.dirname(config), configPath: config }
      : {
          config: inputJson || {},
          base: path.dirname(input),
          configPath: input,
        };
    marker.toplevel = true;

    await seaEnhanced(inputFin, {
      targets,
      signature: argv.signature,
      marker,
      params: { seaMode: true },
      addition: isConfiguration(input) ? input : undefined,
    });
  } else {
    // Simple SEA: single pre-bundled file (backward compat)
    await sea(inputFin, { targets, signature: argv.signature });
  }
  return;
}
```

**DRY note**: Marker construction logic mirrors the existing pattern at lines 594-619 of `index.ts`. Consider extracting a `buildMarker()` helper if the duplication exceeds 5 lines.

---

### Step 7: Type extensions

**File to modify:** `lib/types.ts`

Add SEA-specific types:

```typescript
export interface SeaEnhancedOptions extends SeaOptions {
  marker: Marker;
  params: WalkerParams;
  addition?: string;
}
```

Import `Marker` and `WalkerParams` from walker. Keep types co-located with their primary consumers.

---

### Step 8: Tests

**New test directories:**

| Directory                    | Purpose                                          | Key Assertions                                                         |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `test/test-85-sea-enhanced/` | Multi-file project with package.json via `--sea` | Executable runs, produces correct output, multiple modules resolved    |
| `test/test-86-sea-assets/`   | Non-JS assets (JSON, text, images)               | `fs.readFileSync` returns correct content for packaged assets          |
| `test/test-87-sea-esm/`      | ESM project (`type: "module"`)                   | `import`/`export` work, `import.meta.url` correct                      |
| `test/test-88-sea-native/`   | Native addon (`.node` file)                      | Addon extracted and loaded correctly                                   |
| `test/test-89-sea-fs-ops/`   | VFS operations                                   | `readdir`, `stat`, `existsSync`, `realpathSync` work on snapshot paths |

Each test follows the pattern from `test/test-00-sea/main.js`:

1. Guard: skip if Node < 22
2. Invoke `utils.pkg.sync(['input', '--sea', '-t', 'host'])`
3. Spawn executable, assert output
4. Cleanup with `utils.filesAfter`

---

## Code Reuse and DRY Strategy

### Existing code to reuse (DO NOT duplicate)

| Module           | Functions/Exports                                                                                                        | Used By                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `lib/common.ts`  | `snapshotify`, `normalizePath`, `insideSnapshot`, `stripSnapshot`, `STORE_*` constants                                   | `sea-assets.ts`, `sea-bootstrap.js` |
| `lib/walker.ts`  | Entire walker — no fork, just a `seaMode` flag                                                                           | `sea.ts` (enhanced)                 |
| `lib/refiner.ts` | `refine()` — path compression, empty dir cleanup                                                                         | `sea.ts` (enhanced)                 |
| `lib/sea.ts`     | `getNodejsExecutable`, `bake`, `downloadFile`, `extract`, `verifyChecksum`, `getNodeOs`, `getNodeArch`, `getNodeVersion` | `seaEnhanced()` in same file        |
| `lib/mach-o.ts`  | `patchMachOExecutable`, `removeMachOExecutableSignature`, `signMachOExecutable`                                          | `seaEnhanced()` signing step        |
| `lib/log.ts`     | `log`                                                                                                                    | All new code                        |

### New shared code to extract

| What                                                      | From                           | Shared By                           |
| --------------------------------------------------------- | ------------------------------ | ----------------------------------- |
| Native addon extraction (extract to cache, SHA256 verify) | `prelude/bootstrap.js:155-242` | `bootstrap.js` + `sea-bootstrap.js` |

Extract the extraction logic into `prelude/native-addon-extract.js`. Both bootstrap files import/inline it. During esbuild bundling for SEA, it gets bundled in. For traditional mode, `packer.ts` inlines it into the prelude template.

### Code consistency rules

1. **Path handling**: Always use `snapshotify`/`normalizePath` from `lib/common.ts`. Never hand-roll snapshot path logic.
2. **Error patterns**: Use `wasReported` from `lib/log.ts` for user-facing errors, consistent with existing codebase.
3. **Async patterns**: Use `fs/promises` for build-time operations (matching `sea.ts` style), sync for bootstrap runtime.
4. **Naming**: `seaEnhanced`/`seaSimple` — verb-adjective pattern matching existing `sea` function.
5. **Type imports**: Import from `lib/types.ts` — extend, don't shadow.

---

## Risks and Mitigations

| Risk                                 | Impact                          | Mitigation                                                                                              |
| ------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@platformatic/vfs` bundle size      | Larger executable               | esbuild tree-shaking. Only import `MemoryProvider` + `VirtualFileSystem`. Measure before/after          |
| VFS startup latency (large projects) | Slow cold start                 | Custom `SEAProvider` with lazy `sea.getRawAsset()` — no upfront loading                                 |
| Polyfill API instability             | Breaking changes                | Pin dependency version. Abstract VFS init behind internal interface                                     |
| Cross-platform native addons         | Wrong `.node` binary for target | Warn when cross-compiling with native addons. Reuse `prebuild-install` logic from `lib/producer.ts:229` |
| Large asset counts in SEA            | Unknown Node.js limits          | Test with 1000+ assets early. File a Node.js issue if limits discovered                                 |
| Source code exposure in SEA          | IP concerns                     | Document clearly in README. Recommend traditional mode for code protection needs                        |
| `node:vfs` lands with different API  | Migration friction              | Thin abstraction layer in bootstrap. `@platformatic/vfs` author aligns API with PR                      |

---

## Verification

### Build verification

```bash
npm run build           # TypeScript + sea-bootstrap bundle
npm run lint            # No lint errors in new code
```

### Unit tests

```bash
npm test                # All existing tests pass (no regressions)
npm run test:22         # Enhanced SEA tests run on Node 22+
```

### Manual integration tests

1. **Multi-file project**: Package a project with `src/`, `lib/`, `node_modules/` via `--sea -t node22-linux-x64`. Run executable, verify all modules resolve.
2. **Asset access**: Package project with `config.json`. Verify `fs.readFileSync('./config.json')` returns correct content inside packaged binary.
3. **ESM project**: Package `type: "module"` project. Verify `import` statements work.
4. **Backward compat**: `pkg single-file.js --sea` still works (simple mode).
5. **Size comparison**: Compare executable sizes between traditional and SEA for same project.
6. **Startup benchmark**: Measure cold start time for traditional vs SEA packaging.

---

## File Summary

| File                              | Action              | Lines (est.) |
| --------------------------------- | ------------------- | ------------ |
| `package.json`                    | Modify              | +5           |
| `.gitignore`                      | Modify              | +1           |
| `lib/walker.ts`                   | Modify              | +15          |
| `lib/sea-assets.ts`               | **Create**          | ~120         |
| `prelude/sea-bootstrap.js`        | **Create**          | ~200         |
| `prelude/native-addon-extract.js` | **Create** (shared) | ~80          |
| `lib/sea.ts`                      | Modify              | +80          |
| `lib/index.ts`                    | Modify              | +20          |
| `lib/types.ts`                    | Modify              | +10          |
| `test/test-85-sea-enhanced/`      | **Create**          | ~50          |
| `test/test-86-sea-assets/`        | **Create**          | ~40          |
| `test/test-87-sea-esm/`           | **Create**          | ~40          |
| `test/test-88-sea-native/`        | **Create**          | ~50          |
| `test/test-89-sea-fs-ops/`        | **Create**          | ~60          |
