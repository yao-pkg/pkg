---
name: performances-compare
description: Run packaging performance benchmarks comparing Standard PKG vs SEA modes (with/without bundling) on a Node.js project. Default target is zwave-js-ui. Measures build time, binary size, and startup time.
user-invocable: true
disable-model-invocation: true
argument-hint: [project-path]
allowed-tools: Read Bash Grep Glob Agent Edit Write TaskCreate TaskUpdate TaskGet TaskList
effort: high
---

# Packaging Performance Comparison

Compare packaging performance across 4 methods using `@yao-pkg/pkg`:

1. **Standard PKG (no bundle)** - Traditional pkg with bytecode, no pre-bundling
2. **Standard PKG (with bundle)** - esbuild pre-bundle then pkg with bytecode
3. **SEA with bundle** - esbuild pre-bundle then `pkg --sea` (enhanced VFS, no bytecode)
4. **SEA without bundle** - `pkg --sea` directly on the project (walker intercepts all files)

## Arguments

- `$0` (optional) - Absolute path to the target project. If omitted, defaults to the **zwave-js-ui** project.

## Default Target: zwave-js-ui

[zwave-js-ui](https://github.com/zwave-js/zwave-js-ui) is an open-source Z-Wave control panel and MQTT gateway. It's the primary benchmark target because:

- It's a large real-world ESM Node.js project
- It uses native addons (`@serialport/bindings-cpp`)
- It has complex dependency trees (`zwave-js`, `@zwave-js/*`)
- It has both CJS and ESM dependencies
- It uses package.json `exports` with wildcards and `#imports`

### zwave-js-ui Setup

The project must be cloned and built before running benchmarks. If not already available:

```bash
git clone https://github.com/zwave-js/zwave-js-ui.git <project-path>
cd <project-path>
npm ci
npm run build  # Compiles TypeScript (server/) and Vite frontend (dist/)
```

### zwave-js-ui Project Structure

- **Entry point**: `server/bin/www.js` (compiled JS, ESM)
- **TypeScript source**: `api/bin/www.ts`
- **Frontend**: `dist/` (Vite build output)
- **Package type**: `"type": "module"` (ESM)
- **Node engine**: `>= 20.19`
- **Store directory**: `store/` (relative to CWD, contains `settings.json`)
- **Listening indicator**: Prints `Listening on port 8091` when ready

### zwave-js-ui Bundle Process

The project uses **esbuild** to pre-bundle for pkg. The bundler script is `esbuild.js`:

```bash
cd <project-path>
node esbuild.js --js-entrypoint  # Use --js-entrypoint to bundle from compiled JS
```

This produces a `build/` directory containing:

- `build/index.js` - Single bundled entry point
- `build/package.json` - Patched package.json with `bin: "index.js"` and pkg assets config
- `build/node_modules/` - External dependencies that can't be bundled:
  - `@serialport/bindings-cpp/prebuilds` (native addon prebuilts)
  - `zwave-js/package.json`
  - `@zwave-js/server/package.json`
  - `@zwave-js/config/package.json` and `@zwave-js/config/config/` (device database)
  - `@zwave-js/config/build/` (compiled config module)
- `build/dist/` - Frontend assets
- `build/snippets/` - Code snippets

The bundle process:

1. esbuild bundles `server/bin/www.js` into `build/index.js` (CJS output)
2. Native `.node` files are handled by a custom esbuild plugin (excluded from bundle, path-rewritten)
3. External dependencies are copied to `build/node_modules/`
4. `package.json` is patched: devDependencies/scripts removed, `bin` set to `index.js`, pkg assets configured

When running pkg from the bundle:

```bash
cd build
pkg . -t node22-linux-x64 --output <output-path>           # Standard PKG
pkg . --sea -t node22-linux-x64 --output <output-path>     # SEA mode
```

### zwave-js-ui pkg Configuration

The project's `package.json` contains pkg config for the non-bundled case:

```json
{
  "pkg": {
    "scripts": ["server/**/*", "node_modules/axios/dist/node/*"],
    "assets": [
      "dist/**/*",
      "snippets/**",
      "node_modules/@serialport/**",
      "node_modules/@zwave-js/serial/node_modules/@serialport/**",
      "node_modules/zwave-js/node_modules/@serialport/**",
      "node_modules/@zwave-js/config/config/**"
    ]
  }
}
```

## Procedure

### 1. Setup

- Determine project path: use `$0` if provided, otherwise look for zwave-js-ui adjacent to the pkg repo (e.g., `../zwave-js-ui`)
- Verify the project exists and has a valid `package.json` with a `bin` entry
- Create a temporary benchmark output directory: `/tmp/pkg-bench-<timestamp>/`
- Copy `store/settings.json` from the project to `/tmp/pkg-bench-<timestamp>/store/settings.json`
- Verify the project is built (check `server/bin/www.js` and `dist/index.html` exist)
- If not built, run `npm run build` in the project

### 2. Link local pkg

Run from the **pkg** repo directory:

```bash
npm run build                        # Ensure pkg is built
```

Use the local pkg binary directly:

```bash
node <pkg-repo>/lib-es5/bin.js ...   # Avoids npx re-installing from npm
```

### 3. Run benchmarks

Create the benchmark output directory and run each method, measuring wall-clock time with `date +%s%N`.

**IMPORTANT: Run each build method 3 times** and report the average. Build times can vary significantly due to disk cache, CPU thermal throttling, and background processes. The first run warms caches; subsequent runs give more stable numbers. Report all individual times and the average.

#### Method A: Standard PKG (no bundle)

```bash
cd <project>
START=$(date +%s%N)
node <pkg-repo>/lib-es5/bin.js . --options experimental-require-module \
  -t node22-linux-x64 --output <outdir>/pkg-nobundle
END=$(date +%s%N)
```

Note: This typically **fails for ESM projects** with `ReferenceError: module is not defined in ES module scope` because the bytecode compiler can't handle ESM syntax. Record the failure and note it in results.

#### Method B: Standard PKG (with bundle)

```bash
cd <project>
START=$(date +%s%N)
node esbuild.js --js-entrypoint
cd build
node <pkg-repo>/lib-es5/bin.js . --options experimental-require-module \
  -t node22-linux-x64 --output <outdir>/pkg-bundle
END=$(date +%s%N)
```

Build time = esbuild + pkg combined.

#### Method C: SEA with bundle

```bash
cd <project>
START=$(date +%s%N)
node esbuild.js --js-entrypoint
cd build
node <pkg-repo>/lib-es5/bin.js . --sea \
  -t node22-linux-x64 --output <outdir>/sea-bundle
END=$(date +%s%N)
```

Build time = esbuild + SEA combined.

#### Method D: SEA without bundle

```bash
cd <project>
START=$(date +%s%N)
node <pkg-repo>/lib-es5/bin.js . --sea \
  -t node22-linux-x64 --output <outdir>/sea-nobundle
END=$(date +%s%N)
```

### 4. Measure startup time

For each produced binary, measure the time until the application is ready. Use this measurement function:

```bash
measure_startup() {
  local binary="$1"
  local label="$2"
  local port="${3:-8091}"
  local ready_pattern="${4:-Listening on port}"

  fuser -k $port/tcp 2>/dev/null 2>&1; sleep 0.3

  local START=$(date +%s%N)
  $binary > /tmp/pkg-bench-out.log 2>&1 &
  local PID=$!

  while ! grep -q "$ready_pattern" /tmp/pkg-bench-out.log 2>/dev/null; do
    sleep 0.01
    if ! kill -0 $PID 2>/dev/null; then
      echo "$label: FAILED (process died)"
      return
    fi
  done

  local END=$(date +%s%N)
  kill $PID 2>/dev/null; wait $PID 2>/dev/null
  echo "$label: $(( (END - START) / 1000000 ))ms"
}
```

For each working binary:

1. Copy `store/settings.json` next to the binary in a `store/` subdirectory
2. Clear native addon cache before the first run of each method: `rm -rf ~/.cache/pkg/`
3. **Run 5 times per binary**. Discard the first run (cold cache outlier). Average the remaining 4 runs.
4. Between runs, kill the previous process and free the port: `fuser -k 8091/tcp; sleep 0.3`
5. Report all individual run times and the computed average

Example:

```bash
rm -rf ~/.cache/pkg/
for i in 1 2 3 4 5; do measure_startup ./sea-bundle "Run $i"; done
# Average = (Run2 + Run3 + Run4 + Run5) / 4
```

### 5. Report

Present results as a markdown table. All times should be averages from multiple runs (3 for build, 4 for startup after discarding cold run):

```
| Method                      | Build Time (avg of 3) | Binary Size | Startup (avg of 4) | Status |
|-----------------------------|-----------------------|-------------|---------------------|--------|
| Standard PKG (no bundle)    | Xs                    | X MB        | Xms                 | OK/FAIL|
| Standard PKG (with bundle)  | Xs                    | X MB        | Xms                 | OK     |
| SEA with bundle             | Xs                    | X MB        | Xms                 | OK     |
| SEA without bundle          | Xs                    | X MB        | Xms                 | OK     |
```

Also include a raw data section below the summary table showing every individual run:

```
### Raw Data

#### Build Times
| Method | Run 1 | Run 2 | Run 3 | Average |
|--------|-------|-------|-------|---------|
| ...    | Xs    | Xs    | Xs    | Xs      |

#### Startup Times
| Method | Run 1 (cold) | Run 2 | Run 3 | Run 4 | Run 5 | Average (2-5) |
|--------|-------------|-------|-------|-------|-------|---------------|
| ...    | Xms         | Xms   | Xms   | Xms   | Xms   | Xms           |
```

Include analysis:

- **Fastest build**: typically SEA+bundle (skips bytecode compilation)
- **Smallest binary**: typically PKG+bundle (bytecode is more compact than source)
- **Fastest startup**: typically PKG+bundle (bytecode pre-compiled) or SEA+bundle
- **ESM support**: SEA without bundle handles ESM natively; standard PKG without bundle typically fails
- **Trade-offs**: SEA preserves source code (no obfuscation), larger binaries; PKG has bytecode but ESM limitations

### 6. Cleanup

- Remove the temporary benchmark directory
- Kill any remaining benchmark processes on port 8091: `fuser -k 8091/tcp`
- Optionally clean up `build/` directory in the target project: `rm -rf <project>/build`

## Adapting for Other Projects

To use with a non-zwave-js-ui project, the user must provide:

1. The path to the project as `$0`
2. The project must have a `package.json` with a `bin` field
3. For bundled methods, the project needs an esbuild/bundler setup. Adjust the bundle command accordingly.
4. Change the `ready_pattern` in `measure_startup` to match the project's ready message (e.g., `"Server started"`, `"listening on"`)
5. Change the `port` if the project uses a different port

## Known Behaviors

- Standard PKG (no bundle) fails for ESM projects (`"type": "module"`) because the V8 bytecode compiler can't handle ESM syntax. This is expected.
- SEA without bundle produces the largest binaries because it includes ALL project files (including devDependencies assets, .d.ts files, etc.)
- SEA without bundle has the slowest startup because it loads thousands of individual files from the VFS on demand
- Binary sizes include the Node.js runtime (~110MB base for linux-x64)
- The `warning: Can't find string offset for section name '.note.100'` messages during SEA injection are harmless
- Native addon `.node` files are extracted to `~/.cache/pkg/` on first run (adds ~200ms to cold start)
