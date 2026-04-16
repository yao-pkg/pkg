---
title: Troubleshooting
description: Fixes and workarounds for common pkg errors — ESM, child_process, inspector, NODE_OPTIONS conflicts.
---

# Troubleshooting

::: tip Check this first
Most pkg issues come from one of three things:

1. **Assets not detected** — files you expect in the binary aren't there. Build with `--debug` and run with `DEBUG_PKG=1` to list the snapshot tree. See [Debug virtual FS](/guide/advanced-debug-vfs).
2. **`NODE_OPTIONS`** leaking in from an IDE or shell. Some options conflict with pkg — see [NODE_OPTIONS conflicts](#error-require-internalmodulestat-is-not-a-function).
3. **Stale cached base binary** — blow away `~/.pkg-cache` and retry.
   :::

## Error: `ERR_REQUIRE_ESM`

Full message: `Error [ERR_REQUIRE_ESM]: require() of ES Module`.

Tracked by [#16](https://github.com/yao-pkg/pkg/issues/16#issuecomment-1945486658). In most cases, adding `--options experimental-require-module` to the `pkg` command line solves it:

```sh
pkg app.js --options experimental-require-module
```

::: tip Node.js >= 22.12.0
This option is **not needed** from Node.js v22.12.0 onwards — `experimental-require-module` is the default. Drop the flag if you've upgraded your pkg target.
:::

## Error: Cannot find module XXX (when using `child_process`)

When you use `child_process` methods inside a packaged binary, `pkg` by default invokes the child using the **packaged Node.js runtime**, not the system `node`. If you're trying to `spawn` some external binary that happens to pass through `node`, or if the child accidentally re-enters the packaged entry file, you'll hit a `Cannot find module` error.

**Fix:** explicitly unset `PKG_EXECPATH` in the child's environment:

```js
const { spawn } = require('child_process');

const child = spawn(process.execPath, [process.argv[1]], {
  env: {
    ...process.env,
    PKG_EXECPATH: '', // tell child: you are NOT inside a pkg binary
  },
});
```

This tells the child process to behave like a plain Node.js invocation instead of a pkg-wrapped one. More context in [PR #90](https://github.com/yao-pkg/pkg/pull/90).

## Error: Cannot execute binary from snapshot

Binaries inside the `/snapshot/` virtual filesystem can't be `exec()`'d directly — the OS needs a real file on a real filesystem to spawn it. Extract it first:

```js
const cp = require('child_process');
const fs = require('fs');
const { pipeline } = require('stream/promises');

let ffmpeg = require('@ffmpeg-installer/ffmpeg').path;

async function loadPlugin() {
  if (process.pkg) {
    // copy ffmpeg to the current directory
    const file = fs.createWriteStream('ffmpeg');
    await pipeline(fs.createReadStream(ffmpeg), file);

    fs.chmodSync('ffmpeg', 0o755);
    console.log('ffmpeg copied to the current directory');
    ffmpeg = './ffmpeg';
  }

  cp.execSync(ffmpeg);
}

loadPlugin();
```

For `.node` native addons, `pkg` does this extraction automatically — see [Native addons](/guide/native-addons). For **arbitrary** binaries (ffmpeg, ripgrep, protoc, …) you have to do it yourself.

## Error: `ENOENT: no such file or directory, uv_chdir`

Usually means the directory the app was launched from (`process.cwd()`) was deleted while the app was still running. Check your code for anything that removes `process.cwd()` — temp directories in `/tmp` are common culprits. Not a pkg bug; reproduces under plain `node` too.

## Error: `ERR_INSPECTOR_NOT_AVAILABLE`

Caused by `NODE_OPTIONS` forcing `node` into debug mode. Debugging options are **intentionally disallowed** inside packaged binaries — pkg executables are usually used in production environments where exposing an inspector port is a security risk.

**Workarounds:**

1. Unset `NODE_OPTIONS` before launching:
   ```sh
   NODE_OPTIONS='' ./app
   ```
2. Or build a debuggable Node.js yourself and use it as a custom base binary — see the [issue #93 workaround](https://github.com/yao-pkg/pkg/issues/93#issuecomment-301210543) and [Custom Node.js binary](/guide/custom-node).

## Error: `require(...).internalModuleStat is not a function`

Same root cause as the inspector error — `NODE_OPTIONS` (typically set automatically by IDEs like VS Code) is injecting bootstrap options that conflict with pkg's prelude.

On Unix (Linux / macOS):

```bash
printenv | grep NODE
```

On Windows PowerShell:

```powershell
Get-ChildItem Env: | Where-Object Name -match '^NODE'
```

**Fix:** clear `NODE_OPTIONS` and any other `NODE_*` variables in the terminal where you run the binary:

```sh
unset NODE_OPTIONS NODE_DEBUG NODE_EXTRA_CA_CERTS NODE_NO_WARNINGS
./app
```

If your shell or IDE re-adds them automatically, add an exception rule — e.g. in VS Code add `"terminal.integrated.env.linux": { "NODE_OPTIONS": null }` to disable the auto-injection just for this project.

## AI-assisted debugging with Claude Code

If you use [Claude Code](https://docs.anthropic.com/en/docs/claude-code), you can install the `/pkg-debug` skill to get interactive AI-assisted troubleshooting for any packaging issue.

### Install the skill

Download the skill file into your project's `.claude/skills/` directory:

```bash
mkdir -p .claude/skills/pkg-debug
curl -fsSL https://raw.githubusercontent.com/yao-pkg/pkg/main/.claude/skills/pkg-debug/SKILL.md \
  -o .claude/skills/pkg-debug/SKILL.md
```

::: tip Already cloned the repo?
If you're working inside a clone of `yao-pkg/pkg`, the skill is already available — no extra setup needed.
:::

### Use it

Start a new Claude Code session (skills are loaded at session start), then invoke it with a description of your issue:

```
/pkg-debug my binary crashes with "Cannot find module X"
/pkg-debug binary is 500 MB, how do I reduce size?
/pkg-debug cross-compile from linux to macos not working
/pkg-debug native addon fails to load after packaging
```

The skill covers build failures, runtime crashes, missing assets, binary bloat, cross-compile regressions, native addons, SEA issues, and the `patches` / `dictionary` systems — all linked back to these docs.

## Still stuck?

- Search existing issues: [github.com/yao-pkg/pkg/issues](https://github.com/yao-pkg/pkg/issues)
- Open a new one with the output of `pkg --debug` and `DEBUG_PKG=1 ./your-binary`
- Check the [recipes](/guide/recipes) for an example that matches your setup
