---
name: pkg-debug
description: >
  Debug and troubleshoot @yao-pkg/pkg packaging issues — build failures,
  runtime crashes, missing assets, bloated binaries, native addon errors,
  cross-compile regressions, SEA sentinel problems, and patches/dictionaries.
when_to_use: >
  "debug pkg", "pkg not working", "packaged binary crashes", "missing file
  in binary", "binary too large", "cross-compile broken", "native addon
  fails", "SEA error", "Multiple occurences of sentinel", "ERR_REQUIRE_ESM",
  "Cannot find module" in pkg context, "Cannot execute binary from snapshot"
user-invocable: true
disable-model-invocation: false
argument-hint: [description of the issue]
allowed-tools: Read Bash Grep Glob Agent
effort: high
---

# pkg Debugging & Troubleshooting

Diagnose and fix issues when packaging Node.js apps with `@yao-pkg/pkg`.

**User's issue:** $ARGUMENTS

**Official docs:** <https://yao-pkg.github.io/pkg/>

For the full pkg configuration schema, patches examples, dictionary format,
and contributing guide, see [reference.md](reference.md).

## Triage — Start here

Identify the failure stage:

| Stage             | Symptom                                           | Jump to                                      |
| ----------------- | ------------------------------------------------- | -------------------------------------------- |
| **Build**         | `pkg` exits with error before producing a binary  | [Build failures](#build-failures)            |
| **Runtime**       | Binary produced but crashes/errors on launch      | [Runtime errors](#runtime-errors)            |
| **Missing files** | App runs but can't find assets/modules at runtime | [Missing assets](#missing-assets-or-modules) |
| **Binary size**   | Binary is unexpectedly large                      | [Binary bloat](#binary-bloat)                |
| **Cross-compile** | Build OK on host but binary broken on target      | [Cross-compile](#cross-compile-issues)       |
| **Native addons** | `.node` files fail to load                        | [Native addons](#native-addon-issues)        |
| **SEA-specific**  | Enhanced SEA sentinel/blob/fuse errors            | [SEA issues](#sea-specific-issues)           |

## Diagnostic tools

### CLI flags

```bash
pkg --debug app.js -o dist/app      # Inject diagnostic prelude (build-time)
pkg . --sea                          # Enhanced SEA (stock Node.js, no bytecode)
pkg . --no-bytecode                  # Standard mode without V8 bytecode
pkg . --options max-old-space-size=4096  # Bake Node.js flags into binary
```

### Runtime environment variables

These work **inside the packaged binary**, not at build time.

| Variable                | Values | Purpose                                                                     |
| ----------------------- | ------ | --------------------------------------------------------------------------- |
| `DEBUG_PKG`             | `1`    | Dump VFS tree + symlink table at startup (needs `--debug` build)            |
| `DEBUG_PKG`             | `2`    | Above + trace every `fs` call (readFile, stat, readdir, ...)                |
| `DEBUG_PKG_PERF`        | `1`    | Startup performance report (SEA only, works without `--debug`)              |
| `SIZE_LIMIT_PKG`        | bytes  | With `DEBUG_PKG`, only show files larger than N (default 5 MB)              |
| `FOLDER_LIMIT_PKG`      | bytes  | With `DEBUG_PKG`, only show folders larger than N (default 10 MB)           |
| `PKG_NATIVE_CACHE_PATH` | path   | Override native addon extraction directory (default `~/.cache/pkg-native/`) |

### Standard diagnostic workflow

```bash
# 1. Build with diagnostic prelude
pkg --debug . -o dist/app

# 2. List everything in the VFS
DEBUG_PKG=1 ./dist/app

# 3. Search for a specific file
DEBUG_PKG=1 ./dist/app 2>&1 | grep "myfile.json"

# 4. Trace all fs calls at runtime
DEBUG_PKG=2 ./dist/app

# 5. SEA startup profiling (no --debug needed)
DEBUG_PKG_PERF=1 ./dist/app
```

---

## Build failures

### `ERR_REQUIRE_ESM`

ESM module loaded via `require()`.

```bash
pkg app.js --options experimental-require-module
```

Not needed on Node >= 22.12.0 (flag is default).
See: <https://yao-pkg.github.io/pkg/guide/troubleshooting#error-err-require-esm>

### `Multiple occurences of sentinel` (SEA)

`@yao-pkg/pkg` is in the project's `dependencies` — the walker bundles it
into the SEA archive and the sentinel string causes postject to fail.

**Fix:** move `@yao-pkg/pkg` to `devDependencies`, or upgrade to pkg >= 6.16.0.

### Bytecode compilation fails for cross-arch

Node 22 V8 bytecode is architecture-specific.

```bash
# Option 1: Use SEA (no bytecode step)
pkg . --sea -t node22-linux-arm64

# Option 2: Skip bytecode
pkg . --no-bytecode --public-packages '*' --public -t node22-linux-arm64

# Option 3: Target Node 24 (regression fixed)
pkg . -t node24-linux-arm64
```

---

## Runtime errors

### `Cannot find module XXX` (child_process)

Child process re-enters the packaged binary. Unset `PKG_EXECPATH`:

```js
spawn(process.execPath, [...], {
  env: { ...process.env, PKG_EXECPATH: '' }
});
```

See: <https://yao-pkg.github.io/pkg/guide/troubleshooting#error-cannot-find-module-xxx-when-using-child-process>

### `Cannot execute binary from snapshot`

OS can't exec binaries from VFS. Extract to disk first:

```js
if (process.pkg) {
  const { pipeline } = require('stream/promises');
  const file = fs.createWriteStream('ffmpeg');
  await pipeline(fs.createReadStream('/snapshot/path/ffmpeg'), file);
  fs.chmodSync('ffmpeg', 0o755);
}
```

`.node` native addons are auto-extracted. Other binaries must be extracted manually.
See: <https://yao-pkg.github.io/pkg/guide/troubleshooting#error-cannot-execute-binary-from-snapshot>

### `ERR_INSPECTOR_NOT_AVAILABLE` / `internalModuleStat is not a function`

`NODE_OPTIONS` leaking from IDE/shell. Clear them:

```bash
unset NODE_OPTIONS NODE_DEBUG NODE_EXTRA_CA_CERTS NODE_NO_WARNINGS
./app
```

See: <https://yao-pkg.github.io/pkg/guide/troubleshooting#error-err-inspector-not-available>

---

## Missing assets or modules

### Why files go missing

1. **Dynamic `require(variable)`** — walker can't statically resolve it
2. **Non-JS assets** (templates, JSON, images) — not followed by walker
3. **`path.join` with variable** — `path.join(__dirname, var)` not detected

### Auto-detection rules

`pkg` auto-detects `path.join(__dirname, 'literal.ext')` **only when:**

- Exactly 2 arguments
- Second argument is a **string literal** (not a variable, not a template with expressions)

See: <https://yao-pkg.github.io/pkg/guide/detecting-assets>

### Manual configuration (package.json)

```json
{
  "pkg": {
    "scripts": ["build/**/*.js"],
    "assets": ["views/**/*", "templates/**/*.html", "config/*.json"]
  }
}
```

- **`scripts`** — JS files compiled to V8 bytecode (source stripped).
- **`assets`** — raw files embedded as-is, accessible under `/snapshot/`.

### Verification

```bash
pkg --debug . -o dist/app
DEBUG_PKG=1 ./dist/app 2>&1 | grep "expected-file"
```

If the file is missing, add it to `assets`. If it's a JS file loaded dynamically, add to `scripts`.

---

## Binary bloat

### Diagnose

```bash
pkg --debug . -o dist/app
SIZE_LIMIT_PKG=500000 FOLDER_LIMIT_PKG=2000000 DEBUG_PKG=1 ./dist/app
```

### Fix with `ignore`

```json
{
  "pkg": {
    "ignore": [
      "**/*/node_modules/*/test/**",
      "**/*/node_modules/*/docs/**",
      "**/*/node_modules/*/.github/**"
    ]
  }
}
```

Note: `**` and `*` do NOT match dotfiles — spell `.github` explicitly.

### Consider SEA with bundler

Pre-bundle with esbuild/webpack, then `pkg --sea bundle.js`. This produces
the smallest SEA binaries because only reachable code is included.

See: <https://yao-pkg.github.io/pkg/guide/advanced-debug-vfs>

---

## Cross-compile issues

### Node 22 Standard mode regression

Standard cross-compile is **broken on Node 22**:

- `linux-arm64` → runtime crash `Error: UNEXPECTED-20` ([#181](https://github.com/yao-pkg/pkg/issues/181))
- `win-x64` → silent exit code 4, no output ([#87](https://github.com/yao-pkg/pkg/issues/87))

**Workarounds:** (any one)

1. `pkg . --sea` (Enhanced SEA — works out of the box)
2. `pkg . --no-bytecode --public-packages '*' --public` (skip bytecode)
3. Target Node 20 or Node 24 (regression is Node-22-specific)

### Cross-platform SEA builds

SEA cross-compile works when host major == target major. When they differ,
pkg must execute the downloaded target binary to generate the blob — this
fails for cross-platform builds (Linux host can't run macOS binary).

**Rule:** match host Node major to target Node major. Use `nvm use <major>`
before running `pkg`.

---

## Native addon issues

Native `.node` files are auto-extracted to `~/.cache/pkg-native/<sha256>/`.

### Common problems

- **`linuxstatic` target** cannot load native addons — use `linux` target
- **Arch mismatch** — `.node` must be compiled for **target** arch
- **Cache deleted** — antivirus may clean cache dir. Set `PKG_NATIVE_CACHE_PATH`
- **Missing `.node` file** — add to `assets`: `"node_modules/pkg/prebuilds/**/*.node"`

See: <https://yao-pkg.github.io/pkg/guide/native-addons>

---

## SEA-specific issues

### Mode selection

| Input                             | Mode                                         |
| --------------------------------- | -------------------------------------------- |
| `pkg app.js --sea`                | Simple SEA (single bundled file)             |
| `pkg . --sea` (with package.json) | Enhanced SEA (full walker + VFS)             |
| `pkg .` (no `--sea`)              | Standard mode (V8 bytecode, patched Node.js) |

### `DEBUG_PKG_PERF=1` output interpretation

```
[pkg:perf] manifest parse       14.0ms    ← JSON parsing overhead
[pkg:perf] archive load          1.2ms    ← Raw binary load
[pkg:perf] vfs mount + hooks     3.3ms    ← fs patching
[pkg:perf] module loading      730.1ms    ← require() chain
```

High `module loading` → too many files; consider pre-bundling with esbuild.

### Worker threads in SEA

SEA auto-patches the `Worker` constructor for `/snapshot/` paths. If a worker
fails to find its module, verify with `DEBUG_PKG=1` that the file is in the VFS.

See: <https://yao-pkg.github.io/pkg/guide/sea-mode>

---

## Patches and dictionaries

When a dependency uses code patterns that don't work in packaged apps (e.g.
`require('inspector')`, hardcoded paths, dynamic imports), use `patches` in
your `package.json` `pkg` config. `pkg` also ships built-in `dictionary/`
entries for known packages that are applied automatically.

For the full patches format, real-world examples, monorepo path conventions,
dictionary file structure, and contributing guide, see [reference.md](reference.md).

---

## Quick checklist

When a user reports any pkg issue, run through this:

1. **What mode?** Standard or SEA? (`--sea` flag or `pkg.sea: true`)
2. **What Node version?** Host and target (`node --version`, target triple)
3. **Build or runtime failure?** Does `pkg` succeed? Does the binary run?
4. **`DEBUG_PKG=1`** — is the expected file in the VFS?
5. **`NODE_OPTIONS` clean?** — `printenv | grep NODE`
6. **Stale cache?** — `rm -rf ~/.pkg-cache && pkg ...`
7. **Patches needed?** — check if the failing module uses `inspector`,
   dynamic imports, or hardcoded paths → see [reference.md](reference.md)
8. **Native addons?** — verify `.node` files match target arch
9. **Cross-compile?** — Node 22 Standard mode is broken; use SEA or Node 24
10. **Bug in pkg itself?** — see [contributing guide](reference.md#contributing-fixes-back-to-pkg)
