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

| Field              | Type                                     | CLI equivalent         | Notes                                                |
| ------------------ | ---------------------------------------- | ---------------------- | ---------------------------------------------------- |
| `input`            | `string`                                 | positional `<input>`   | **Required.** Entry file or directory.               |
| `targets`          | `string \| string[]`                     | `--targets`            | e.g. `'host'` or `['node22-linux-x64', ...]`.        |
| `config`           | `string`                                 | `--config`             | Path to `package.json` or standalone config JSON.    |
| `output`           | `string`                                 | `--output`             | Output file name or template.                        |
| `outputPath`       | `string`                                 | `--out-path`           | Output directory (mutually exclusive with `output`). |
| `compress`         | `'None' \| 'Brotli' \| 'GZip' \| 'Zstd'` | `--compress`           | Default `'None'`.                                    |
| `sea`              | `boolean`                                | `--sea`                | Use Single Executable Application mode.              |
| `bakeOptions`      | `string \| string[]`                     | `--options`            | Node/V8 flags baked into the binary.                 |
| `debug`            | `boolean`                                | `--debug`              | Verbose packaging logs.                              |
| `build`            | `boolean`                                | `--build`              | Build base binaries from source.                     |
| `bytecode`         | `boolean`                                | `--no-bytecode`        | Default `true`. Set `false` to ship plain JS.        |
| `nativeBuild`      | `boolean`                                | `--no-native-build`    | Default `true`.                                      |
| `fallbackToSource` | `boolean`                                | `--fallback-to-source` | Ship source when bytecode compile fails.             |
| `public`           | `boolean`                                | `--public`             | Top-level project is public.                         |
| `publicPackages`   | `string \| string[]`                     | `--public-packages`    | Use `['*']` for all.                                 |
| `noDictionary`     | `string \| string[]`                     | `--no-dict`            | Use `['*']` to disable all dictionaries.             |
| `signature`        | `boolean`                                | `--no-signature`       | Default `true` (macOS signing when applicable).      |

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

## See also

- [CLI options](/guide/options)
- [Recipes: build in CI](/guide/recipes#build-all-targets-in-ci)
