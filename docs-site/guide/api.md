---
title: Node.js API
description: Call pkg programmatically from a Node.js build script instead of the CLI.
---

# Node.js API

In addition to the CLI, `pkg` exposes a small programmatic API so you can drive builds from a Node.js script — useful for custom release pipelines, CI integration, or wrapping `pkg` inside a bigger build tool.

## Install

```sh
npm install --save-dev @yao-pkg/pkg
```

## Import

::: code-group

```js [CommonJS]
const { exec } = require('@yao-pkg/pkg');
```

```js [ESM]
import { exec } from '@yao-pkg/pkg';
```

:::

## `exec()`

`exec()` accepts either a CLI-style argv array **or** a typed options object, and returns a `Promise<void>` that resolves when the build is complete, or rejects on failure.

### Options object (recommended)

```ts
import { exec, PkgExecOptions } from '@yao-pkg/pkg';

await exec({
  input: 'index.js',
  targets: ['node22-linux-x64'],
  output: 'dist/app',
  compress: 'Brotli',
});
```

Only `input` is required. Everything else mirrors the CLI flags — see the [full field list](#pkgexecoptions-fields) below.

### Argv array

```js
const { exec } = require('@yao-pkg/pkg');

await exec(['index.js', '--target', 'host', '--output', 'dist/app']);
```

The strings are exactly what you'd pass on the command line — see [Getting started → CLI reference](/guide/getting-started#cli-reference).

### `PkgExecOptions` fields

| Field              | Type                                                                     | CLI equivalent         | Notes                                                                             |
| ------------------ | ------------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------- |
| `input`            | `string`                                                                 | positional `<input>`   | **Required.** Entry file or directory.                                            |
| `targets`          | `string[]`                                                               | `--targets`            | e.g. `['host']` or `['node22-linux-x64', ...]`.                                   |
| `config`           | `string`                                                                 | `--config`             | Path to `package.json` or standalone config JSON.                                 |
| `output`           | `string`                                                                 | `--output`             | Output file name or template.                                                     |
| `outputPath`       | `string`                                                                 | `--out-path`           | Output directory (mutually exclusive with `output`).                              |
| `compress`         | `'None' \| 'Brotli' \| 'GZip' \| 'Zstd'`                                 | `--compress`           | Default `'None'`.                                                                 |
| `sea`              | `boolean`                                                                | `--sea`                | Use Single Executable Application mode.                                           |
| `bakeOptions`      | `string \| string[]`                                                     | `--options`            | Node/V8 flags baked into the binary (e.g. `['expose-gc']`).                       |
| `debug`            | `boolean`                                                                | `--debug`              | Verbose packaging logs.                                                           |
| `build`            | `boolean`                                                                | `--build`              | Build base binaries from source.                                                  |
| `bytecode`         | `boolean`                                                                | `--no-bytecode`        | Default `true`. Set `false` to ship plain JS.                                     |
| `nativeBuild`      | `boolean`                                                                | `--no-native-build`    | Default `true`.                                                                   |
| `fallbackToSource` | `boolean`                                                                | `--fallback-to-source` | Ship source when bytecode compile fails.                                          |
| `public`           | `boolean`                                                                | `--public`             | Top-level project is public.                                                      |
| `publicPackages`   | `string[]`                                                               | `--public-packages`    | Use `['*']` for all.                                                              |
| `noDictionary`     | `string[]`                                                               | `--no-dict`            | Use `['*']` to disable all dictionaries.                                          |
| `signature`        | `boolean`                                                                | `--no-signature`       | Default `true` (macOS signing when applicable).                                   |
| `preBuild`         | `string \| () => void \| Promise<void>`                                  | _(none — API/config)_  | Shell command or function run before the walker. See [Build hooks](#build-hooks). |
| `postBuild`        | `string \| (output: string) => void \| Promise<void>`                    | _(none — API/config)_  | Run once per produced binary. Shell form receives `PKG_OUTPUT` env.               |
| `transform`        | `(file: string, contents: Buffer \| string) => Buffer \| string \| void` | _(none — API only)_    | Per-file content transform (minify, obfuscate, etc.).                             |

## Build a full release pipeline

```js
const { exec } = require('@yao-pkg/pkg');
const { mkdir, rm } = require('node:fs/promises');
const path = require('node:path');

const DIST = 'dist';
const TARGETS = [
  'node22-linux-x64',
  'node22-linux-arm64',
  'node22-macos-arm64',
  'node22-win-x64',
];

async function build() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  await exec({
    input: '.',
    targets: TARGETS,
    outputPath: DIST,
    compress: 'Brotli',
  });

  console.log(`built ${TARGETS.length} binaries into ${path.resolve(DIST)}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## Error handling

`exec` rejects with an `Error` whose `message` contains the same diagnostic you'd see on the CLI. Wrap in try/catch (or chain `.catch`) if you need to react to specific failures:

```js
try {
  await exec(['bad/input.js']);
} catch (err) {
  console.error('pkg build failed:', err.message);
  process.exitCode = 1;
}
```

## Build hooks

`pkg` exposes three hooks that run at well-defined points in the build pipeline. They turn shell scripts that previously had to wrap `pkg` (pre-bundle, smoke-test, minify, etc.) into first-class config.

### Lifecycle order

```
preBuild → walk → transform (per file) → bytecode/compression → write → postBuild (per binary)
```

### `preBuild`

Runs once before the walker collects files. Use it for setup work — pre-bundling with esbuild/webpack, codegen, fetching assets. Throw or exit non-zero to abort the build.

::: code-group

```js [Function]
await exec({
  input: 'src/index.js',
  preBuild: async () => {
    await build({ entryPoints: ['src/index.js'], outfile: 'dist/bundle.js' });
  },
});
```

```json [package.json#pkg]
{
  "pkg": {
    "preBuild": "esbuild src/index.js --bundle --outfile=dist/bundle.js"
  }
}
```

:::

### `postBuild`

Runs once per produced binary, after the file has been written and (where applicable) codesigned. Use it for smoke tests, signing, notarization, upload. The shell form receives the absolute output path via the `PKG_OUTPUT` environment variable; the function form receives it as the first argument.

::: code-group

```js [Function]
await exec({
  input: 'src/index.js',
  postBuild: async (output) => {
    await execFileAsync(output, ['--version']);
  },
});
```

```json [package.json#pkg]
{
  "pkg": {
    "postBuild": "\"$PKG_OUTPUT\" --version"
  }
}
```

:::

### `transform`

JS-function-only — applied to each file the walker collected, after refinement and before bytecode/compression. Receives the absolute on-disk path and current contents, returns the replacement (a `Buffer` or `string`) or `undefined`/`void` to leave the file unchanged.

`transform` is the hook for **minification and obfuscation** — `pkg` deliberately ships no minifier of its own so the runtime dependency footprint stays small. Drop in your tool of choice:

```js
import { exec } from '@yao-pkg/pkg';
import { minify } from 'terser';

await exec({
  input: 'src/index.js',
  output: 'dist/app',
  transform: async (file, contents) => {
    if (!file.endsWith('.js')) return; // leave non-JS untouched
    const { code } = await minify(contents.toString());
    return code;
  },
});
```

The transform sees the **exact** set of files `pkg` is embedding (walker output, post-refine), never the user's source tree on disk — so the original repo is left intact.

### Notes

- Shell hooks are spawned with `shell: true` and inherit stdio, so the user sees their tool's live output. Non-zero exit fails the build.
- Function-form hooks are reachable from the Node.js API and from `pkg.config.{js,cjs,mjs}` (which can export a function value); JSON-format config (`package.json#pkg`, `.pkgrc`, `.pkgrc.json`) can only carry the shell-string form.
- In simple SEA mode (`--sea` without a `package.json`), `transform` is a no-op — there's no walker output to apply per-file rewrites to. `preBuild` and `postBuild` still run.

## See also

- [CLI options](/guide/options)
- [Recipes: build in CI](/guide/recipes#build-all-targets-in-ci)
