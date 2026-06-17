---
title: Custom Node.js binary
description: Use your own Node.js binary as the base for a pkg build — useful for custom metadata, security patches, or unusual architectures.
---

# Custom Node.js binary

By default `pkg` downloads a pre-compiled, patched Node.js binary from [`pkg-fetch`](https://github.com/yao-pkg/pkg-fetch) and uses it as the base for every executable it creates. For most projects this is exactly what you want.

If you need a **custom** base binary — for an architecture not covered by `pkg-fetch`, a build with specific V8 flags, or a Node.js you've already patched for Windows metadata or corporate compliance — set `PKG_NODE_PATH` to point at it:

```bash
PKG_NODE_PATH=/path/to/node pkg app.js
```

`pkg` will use that binary as the base instead of fetching one.

## When to use a custom binary

- **Unsupported architectures** — `pkg-fetch` covers Linux / macOS / Windows on x64 + arm64. For anything else (RISC-V, armv6, BSD), compile Node.js yourself or use a [`pkg-binaries`](https://github.com/yao-pkg/pkg-binaries) build.
- **Pre-embedded metadata** — on Windows, you can compile a Node.js binary that already has your product name, icon, and version baked in. Then `pkg`-ing your JS on top preserves it. See [Windows metadata](/guide/advanced-windows-metadata) for an alternative post-processing approach.
- **Security policy** — enterprises that pin Node.js to a specific internal build can feed it into `pkg`.
- **Debug builds** — a debug-enabled Node.js lets you attach a debugger to the packaged app in development.

## Caveats

- The binary must be a **compatible** Node.js version — `pkg` still injects its bootstrap prelude and payload, and depends on specific symbol offsets. Use a version supported by `pkg-fetch` unless you know what you're doing.
- `PKG_NODE_PATH` affects a **single target**. In standard mode, multi-target builds still fetch the other platforms from `pkg-fetch` unless you set it per-run.
- SEA mode honours `PKG_NODE_PATH` too. Because SEA injects the payload into the supplied binary directly (there is no per-platform fetch fallback), a custom base binary there is restricted to a **single target**, and pkg validates the binary against it rather than baking a mismatched binary into the output: it **runs the binary** and checks what it reports — `process.platform` and `process.arch` must match the target (a macOS binary for a `linux` target, or an x64 binary for an `arm64` target, is rejected), and its major version must match the target's. This means **the custom base binary must be runnable on the build host** (pkg already runs it to read its version). It also rejects targets that span more than one `platform`/`arch` (one binary can't be several at once — including `linux` vs `alpine` vs `linuxstatic`, which all report `process.platform` `linux` but clearly can't all be meant simultaneously). The glibc/musl/static flavor isn't reported by Node, so matching that to `linux`/`alpine`/`linuxstatic` remains your responsibility. You can point at the binary with the `--sea-node-path` CLI flag or the `seaNodePath` pkg-config key (both override `PKG_NODE_PATH`). To embed the Node.js you're currently running, pass `PKG_NODE_PATH="$(command -v node)"` (or `--sea-node-path "$(command -v node)"`).

## See also

- [Build from source](/guide/build)
- [Windows metadata](/guide/advanced-windows-metadata)
- [pkg-binaries](https://github.com/yao-pkg/pkg-binaries)
