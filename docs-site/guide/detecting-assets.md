---
title: Detecting assets
description: How pkg finds assets statically via path.join(__dirname, ...) — rules, pitfalls, and escape hatches.
---

# Detecting assets in source code

When `pkg` encounters `path.join(__dirname, '../path/to/asset')`, it automatically packages the referenced file as an asset — no manual `assets` entry needed. This static analysis avoids forcing every project to configure its assets explicitly.

## The supported pattern

```js
path.join(__dirname, 'views/greeting.html'); // ✅ detected
path.join(__dirname, 'migrations/001.sql'); // ✅ detected
path.join(__dirname, '../data/cities.json'); // ✅ detected
```

::: warning Two arguments only
`path.join` must have **exactly two arguments**, and the second must be a **string literal**. Anything else — three args, a variable, a template literal with expressions — is not detected.
:::

## Not detected

```js
const view = 'greeting.html';
path.join(__dirname, 'views', view); // ❌ three arguments
path.join(__dirname, `views/${name}.html`); // ❌ expression inside template
const p = 'views/greeting.html';
path.join(__dirname, p); // ❌ variable, not literal
```

For these, list the file(s) manually in the `assets` glob — see [Configuration → Assets](/guide/configuration#assets).

## Why this matters

The static walker rewrites detected calls so that at runtime, the resolved path points at `/snapshot/...` and the asset is served from the virtual filesystem. If the call isn't detected, the asset isn't bundled — and your packaged binary will throw `ENOENT` at runtime.

## How to find missing assets

1. Build with `--debug`:
   ```sh
   pkg --debug index.js
   ```
2. Run the binary with `DEBUG_PKG=1`:
   ```sh
   DEBUG_PKG=1 ./app-linux
   ```
3. Look at the snapshot tree in the output — is your asset there? If not, either fix the call-site to match the supported pattern or add the asset to the `assets` glob.

See [Debug virtual FS](/guide/advanced-debug-vfs) for the full debug workflow.

## Escape hatch — dynamic assets

If your asset paths are genuinely dynamic (e.g. user-selected theme, loaded language pack), glob the whole directory in `package.json`:

```json
{
  "pkg": {
    "assets": ["themes/**/*", "i18n/**/*.json"]
  }
}
```

This packages everything matching the glob, regardless of whether any specific `path.join(...)` call is statically analysable.

## See also

- [Configuration → Assets](/guide/configuration#assets)
- [Snapshot filesystem](/guide/snapshot-fs)
- [Debug virtual FS](/guide/advanced-debug-vfs)
