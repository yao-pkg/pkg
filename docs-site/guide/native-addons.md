# Native addons

Native addons (`.node` files) are supported. When `pkg` encounters a `.node` file in a `require` call, it packages it like an asset. In some cases (like with the `bindings` package) the module path is generated dynamically and `pkg` can't detect it. In that case, add the `.node` file directly to the `assets` field in `package.json`.

The way Node.js requires native addons is different from a classic JS file: it needs a file on disk to load it, but `pkg` only produces one file. To work around this, `pkg` extracts native addon files to `$HOME/.cache/pkg/` by default. These files stay on disk after the process exits and are reused on the next launch.

You can customise the cache directory with the `PKG_NATIVE_CACHE_PATH` environment variable. This is useful in enterprise environments where specific directories are restricted or monitored:

```bash
# Set custom cache path for native addons
PKG_NATIVE_CACHE_PATH=/opt/myapp/cache ./myapp
```

When a package containing a native module is installed, the native module is compiled against the current system-wide Node.js version. When you compile your project with `pkg`, pay attention to the `--target` option: you should specify the same Node.js version as your system-wide Node.js to make the compiled executable compatible with the `.node` files.

::: warning linuxstatic
Fully static Node binaries cannot load native bindings, so you may not use Node bindings with `linuxstatic`.
:::
