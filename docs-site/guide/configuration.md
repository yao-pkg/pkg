---
title: Configuration
description: Configure pkg via the pkg property in package.json — scripts, assets, ignore globs, targets, output path, and more.
---

# Configuration

`pkg` auto-detects most dependencies by walking `require` / `import` from your entry file (see [how it works](/guide/)). You only need to configure it when your code uses dynamic `require(variable)` calls or non-JavaScript files (views, CSS, images, etc.):

```js
require('./build/' + cmd + '.js');
path.join(__dirname, 'views/' + viewName);
```

These cases are not handled automatically. You must specify scripts and assets manually in the `pkg` property of your `package.json`.

```json
{
  "pkg": {
    "scripts": "build/**/*.js",
    "assets": "views/**/*",
    "targets": ["node22-linux-arm64"],
    "outputPath": "dist"
  }
}
```

The example above includes everything in `assets/` and every `.js` file in `build/`, builds only for `node22-linux-arm64`, and places the executable inside `dist/`.

You may also specify arrays of globs:

```json
{
  "pkg": {
    "assets": ["assets/**/*", "images/**/*"]
  }
}
```

Call `pkg package.json` or `pkg .` to make use of the `package.json` configuration.

## Standalone config file

If you prefer to keep `package.json` clean, drop a dedicated config file next to your entry point. `pkg` looks for these names, in order, and uses the first one it finds:

1. `.pkgrc` — JSON
2. `.pkgrc.json` — JSON
3. `pkg.config.js` — CommonJS or ESM (follows `"type"` in `package.json`)
4. `pkg.config.cjs` — CommonJS
5. `pkg.config.mjs` — ESM (use this when you need to export functions)

The file contains a bare pkg config (no `pkg` wrapper):

```json
{
  "scripts": "build/**/*.js",
  "assets": "views/**/*",
  "targets": ["node22-linux-x64"],
  "outputPath": "dist"
}
```

```js
// pkg.config.js — use this when you need comments or computed values
module.exports = {
  scripts: 'build/**/*.js',
  assets: ['views/**/*', process.env.EXTRA_ASSET].filter(Boolean),
  targets: ['node22-linux-x64'],
  outputPath: 'dist',
};
```

```js
// pkg.config.mjs — ESM; use this to expose functions
export default {
  scripts: 'build/**/*.js',
  targets: ['node22-linux-x64'],
  outputPath: 'dist',
};
```

Precedence (highest to lowest):

1. `--config <file>` passed on the CLI
2. Auto-discovered `.pkgrc` / `.pkgrc.json` / `pkg.config.js` / `pkg.config.cjs` / `pkg.config.mjs`
3. `pkg` field in `package.json`

When both a pkgrc and a `pkg` field in `package.json` are present, the pkgrc wins and `pkg` logs a warning. `name` and `bin` are still read from `package.json`.

## Full schema

| Key            | Type             | Description                                                                                                                      |
| -------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `scripts`      | glob \| string[] | JS files compiled to V8 bytecode and embedded without source — see [Scripts](#scripts)                                           |
| `assets`       | glob \| string[] | Files embedded as raw content, accessible under `/snapshot/` — see [Assets](#assets)                                             |
| `ignore`       | string[]         | Globs excluded from the final executable — see [Ignore files](#ignore-files)                                                     |
| `targets`      | string[]         | Target triples, e.g. `node22-linux-x64` — see [Targets](/guide/targets)                                                          |
| `outputPath`   | string           | Directory for output binaries (equivalent to CLI `--out-path`)                                                                   |
| `patches`      | object           | Patch modules that can't be packaged as-is — see [pkg source](https://github.com/yao-pkg/pkg/blob/main/dictionary/) for examples |
| `sea`          | boolean          | Opt into [SEA mode](/guide/sea-mode) without passing `--sea`                                                                     |
| `seaConfig`    | object           | Forwarded to Node.js SEA config (`useCodeCache`, `disableExperimentalSEAWarning`, etc.)                                          |
| `deployAssets` | boolean          | Copy `assets` next to the executable at runtime instead of keeping them in the snapshot                                          |

## Scripts

`scripts` is a [glob](https://github.com/SuperchupuDev/tinyglobby) or a list of globs. Files specified as `scripts` are compiled with `v8::ScriptCompiler` and placed into the executable **without sources**. They must conform to the JS standard of the Node.js versions you target (see [Targets](/guide/targets)) — i.e. be already transpiled.

## Assets

`assets` is a [glob](https://github.com/SuperchupuDev/tinyglobby) or a list of globs. Files specified as `assets` are packaged into the executable as raw content without modification. JavaScript files may also be specified as assets. Their sources are not stripped, which improves execution performance and simplifies debugging.

See also [Detecting assets in source code](/guide/detecting-assets) and [Snapshot filesystem](/guide/snapshot-fs).

## Ignore files

`ignore` is a list of globs. Files matching these paths are excluded from the final executable. Useful when you want to exclude tests, documentation, or build files that a dependency brings along:

```json
{
  "pkg": {
    "ignore": ["**/*/dependency-name/build.c"]
  }
}
```

Note that `**` and `*` do **not** match dotfiles like `.git`. Dotfile names must be spelled explicitly in the glob.

To see which unwanted files ended up in your executable, read [Exploring the virtual filesystem in debug mode](/guide/advanced-debug-vfs).

## Typical config

A production-ready `package.json` often looks like this:

```json
{
  "name": "my-tool",
  "version": "1.0.0",
  "bin": "src/cli.js",
  "scripts": {
    "build": "pkg ."
  },
  "pkg": {
    "targets": [
      "node22-linux-x64",
      "node22-linux-arm64",
      "node22-macos-x64",
      "node22-macos-arm64",
      "node22-win-x64"
    ],
    "assets": ["views/**/*", "public/**/*", "migrations/**/*.sql"],
    "ignore": ["**/*/node_modules/*/test/**"],
    "outputPath": "dist"
  }
}
```
