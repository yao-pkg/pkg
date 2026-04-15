---
title: Native addons
description: Bundle .node files into your packaged binary and control where they are extracted at runtime.
---

# Native addons

Native addons (`.node` files) are supported. When `pkg` encounters a `.node` file in a `require` call, it packages it like an asset. In some cases (like with the `bindings` package) the module path is generated dynamically and `pkg` can't detect it. In that case, add the `.node` file directly to the `assets` field in `package.json`.

## Why `.node` files get extracted

Node.js requires a **file on disk** to load a native addon — `dlopen(3)` operates on real paths, not streams. But `pkg` produces one self-contained file, so the `.node` contents live inside the snapshot. At first launch, `pkg` extracts them to a cache directory on disk and then loads them from there.

Extracted files stay on disk after the process exits and are reused on the next launch, so subsequent startups are fast.

## Cache location

Default: `$HOME/.cache/pkg-native/` (resolved via the XDG cache dir on Linux / macOS, `%LOCALAPPDATA%` on Windows).

Override with `PKG_NATIVE_CACHE_PATH`. Useful in enterprise environments where specific directories are restricted or monitored:

::: code-group

```sh [Linux / macOS]
PKG_NATIVE_CACHE_PATH=/opt/myapp/cache ./myapp
```

```powershell [Windows]
$env:PKG_NATIVE_CACHE_PATH = 'C:\ProgramData\MyApp\cache'
.\myapp.exe
```

:::

See [Environment variables](/guide/environment#runtime-inside-the-packaged-app) for the full list.

## Target compatibility

When a package containing a native module is installed, the native module is compiled against the current system-wide Node.js version. When you compile your project with `pkg`, pay attention to the `--target` option: you should specify the **same Node.js version** as your system-wide Node.js to make the compiled executable compatible with the `.node` files.

If you cross-compile for a different platform or arch, ensure you install the right prebuilt binary for that target (or rebuild it with `prebuildify` / `node-gyp` for each target).

## Manual asset inclusion

If `pkg` can't statically detect a `.node` require (e.g. `bindings` or dynamic paths), add it to `assets`:

```json
{
  "pkg": {
    "assets": ["node_modules/better-sqlite3/build/Release/better_sqlite3.node"]
  }
}
```

Native bindings are not supported on the `linuxstatic` target — see [Targets → Alpine / musl](/guide/targets#alpine-musl).

## See also

- [Environment variables](/guide/environment)
- [Detecting assets](/guide/detecting-assets)
- [Recipes: bundle a SQLite addon](/guide/recipes#bundle-a-native-sqlite-addon)
