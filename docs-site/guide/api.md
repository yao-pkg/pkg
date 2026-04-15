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

## `exec(args)`

`exec(args)` takes an array of command-line arguments and returns a `Promise<void>` that resolves when the build is complete, or rejects on failure.

```js
const { exec } = require('@yao-pkg/pkg');

await exec(['index.js', '--target', 'host', '--output', 'dist/app']);

// do something with dist/app, upload, deploy, etc.
```

The array elements are exactly the strings you'd pass on the command line — see [Getting started → CLI reference](/guide/getting-started#cli-reference) for the full option list.

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

  await exec([
    '.',
    '--targets',
    TARGETS.join(','),
    '--out-path',
    DIST,
    '--compress',
    'Brotli',
  ]);

  console.log(`✅ built ${TARGETS.length} binaries into ${path.resolve(DIST)}`);
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
