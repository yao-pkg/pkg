---
title: Targets
description: Cross-compile Node.js binaries for Linux, macOS, and Windows on x64 and arm64 from any host.
---

# Targets

`pkg` can generate executables for several target machines at a time. Pass a comma-separated list via `--targets`, or set `pkg.targets` in `package.json`.

## Target triple

A canonical target has three parts separated by dashes: `<nodeRange>-<platform>-<arch>`.

| Part          | Values                                                        |
| ------------- | ------------------------------------------------------------- |
| **nodeRange** | `node22`, `node24`, `latest`                                  |
| **platform**  | `alpine`, `linux`, `linuxstatic`, `win`, `macos`, (`freebsd`) |
| **arch**      | `x64`, `arm64`, (`armv6`, `armv7`)                            |

Parenthesised values are unsupported out of the box — you may try to compile them yourself.

::: tip host alias
The alias `host` is shorthand for "current platform + Node.js version + arch". Useful in scripts and CI.
:::

If your target is available in the assets of the latest [pkg-fetch release](https://github.com/yao-pkg/pkg-fetch/releases), `pkg` downloads the pre-compiled Node.js binary from that project. Otherwise, or if you specify `--build`, it builds the binary from source (this takes a **very** long time).

Pre-compiled binaries for some unsupported architectures and instructions for using them are available in the [pkg-binaries](https://github.com/yao-pkg/pkg-binaries) project.

You may omit any element (for example `node22`). Omitted elements default to the current platform or the system-wide Node.js version and arch. By default targets are `linux,macos,win` for the current Node.js version and arch.

## Examples

::: code-group

```sh [Single target]
pkg -t node22-linux-arm64 index.js
```

```sh [Multi-target]
pkg -t node22-linux-x64,node22-macos-arm64,node22-win-x64 index.js
```

```sh [Host only]
pkg -t host index.js
```

```json [package.json]
{
  "pkg": {
    "targets": [
      "node22-linux-x64",
      "node22-linux-arm64",
      "node22-macos-x64",
      "node22-macos-arm64",
      "node22-win-x64"
    ]
  }
}
```

:::

## Cross-compilation support

Cross-OS (Linux ↔ Windows ↔ macOS) and cross-arch (x64 ↔ arm64) builds are supported, but the behaviour depends on the **target Node.js version**.

| Host / target Node | Standard mode                       | Enhanced SEA (`--sea`)         |
| ------------------ | ----------------------------------- | ------------------------------ |
| **Node 20**        | ✅ works out of the box             | ❌ requires pkg host Node ≥ 22 |
| **Node 22**        | ⚠️ **known regression** — see below | ✅ works out of the box        |
| **Node 24**        | ✅ works out of the box             | ✅ works out of the box        |

Verified on a Linux x86_64 host against `linux-x64`, `linux-arm64` (docker + QEMU) and `win-x64` (docker + Wine). `macos-*` targets build cleanly but cannot be executed from Linux — regressions reported on macOS hosts must still be reproduced on a real Mac or the GitHub Actions `macos-*` runners.

::: warning Node 22 Standard-mode regression
On Node 22, Standard cross-compile **builds cleanly but produces a broken executable**:

- `linux-arm64` crashes with `Error: UNEXPECTED-20` in `readFileFromSnapshot`
- `win-x64` exits silently with no stdout (EXIT=4)

Tracked in [#87](https://github.com/yao-pkg/pkg/issues/87) and [#181](https://github.com/yao-pkg/pkg/issues/181). Workarounds:

1. **Switch to SEA** — `pkg . --sea`. Avoids the V8 bytecode step entirely.
2. **Disable bytecode** — `pkg . --no-bytecode --public-packages "*" --public`. Keeps Standard mode, stores source as plaintext.
3. **Fallback to source** — `pkg . --fallback-to-source`. Keeps bytecode for files that compile successfully and ships the rest as plain source. See [Bytecode → Fallback to source](/guide/bytecode#fallback-to-source-on-failure).
4. **Target Node 24** — the regression is gone on `node24-*` targets.
5. **Keep bytecode for `win-x64`** — build on Linux with Wine and pass `--cross-bytecode`. The only workaround that preserves source protection for Windows targets. See [Building Windows binaries on Linux (Wine)](#building-windows-binaries-on-linux-wine) below.

:::

### Bytecode and target arch

Regardless of the bug above, the V8 bytecode fabricator in Standard mode needs to execute code compiled for the **target** arch at build time. If the host arch differs from the target:

- **Linux** — configure binfmt with [QEMU](https://wiki.debian.org/QemuUserEmulation)
- **macOS** — you can build `x64` on `arm64` with Rosetta 2, but not the opposite
- **Windows** — you can build `x64` on `arm64` with x64 emulation, but not the opposite
- Or disable bytecode generation entirely with `--no-bytecode --public-packages "*" --public`
- Or use `--fallback-to-source` to ship only the failing files as plain source while keeping bytecode for the rest

Enhanced SEA doesn't have this limitation when the host and target share the same Node major: pkg uses `process.execPath` to generate the SEA blob, so no target-arch interpreter is needed. Cross-major SEA builds (e.g. building `node22-*` targets on a Node 24 host) still require an interpreter for the downloaded target binary.

### Building Windows binaries on Linux (Wine)

When a `win-x64` target's bytecode is fabricated with the **host** (Linux) Node, the target's Windows V8 can reject it at runtime — producing an executable that fails to start (this is the failure mode behind the Node 22 regression above). Passing `--cross-bytecode` runs the **Windows** target Node under [Wine](https://www.winehq.org/) to generate Windows-native bytecode — the OS analogue of using QEMU for a foreign arch.

Wine is an **OS-ABI translation layer**, not a CPU emulator: because `win-x64` is the same CPU arch as an x64 Linux host, there is **no CPU emulation** and fabrication runs at near-native speed. This path is **`x64` host → `win-x64` only**; `win-arm64` from an x64 host would also need CPU emulation and is not supported.

Setup (Debian/Ubuntu shown; adapt for your distro):

```sh
# 1. Install Wine (same CPU arch as the host)
apt-get update && apt-get install -y --no-install-recommends wine wine64

# 2. Register a binfmt_misc handler so the kernel runs .exe files through Wine.
#    pkg forwards the Wine environment (WINEPREFIX, HOME, PATH, …) to the
#    fabricator, so a plain handler with no wrapper script is enough:
echo ':winePE:M::MZ::/usr/bin/wine:' > /proc/sys/fs/binfmt_misc/register

# 3. Build, opting in with --cross-bytecode
pkg --cross-bytecode -t node22-win-x64 index.js
```

::: warning Privileged context required to register binfmt
Registering a `binfmt_misc` handler writes to `/proc/sys/fs/binfmt_misc` and needs a **privileged** context — a rootful `docker run --privileged` / `docker:dind`, or the host kernel. **Rootless** containers cannot mount or write `binfmt_misc`; register the handler on the host instead. It is a kernel-wide setting, so it only needs registering once per host/boot.
:::

`--cross-bytecode` is **off by default** — without it, `win-x64` builds on Linux behave exactly as before. It can also be set as `crossBytecode` in the pkg config. If Wine or the binfmt handler is missing, the build **fails with an error** pointing back here rather than silently producing a broken binary.

To verify end to end, run the produced `.exe` on Windows: it should start with no `V8 rejected the bytecode cache` error, and the app code stays shipped as bytecode (no plaintext sources).

## macOS arm64

`macos-arm64` is experimental. Be careful about the [mandatory code signing requirement](https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes). The final executable has to be signed (an ad-hoc signature is sufficient) with the `codesign` utility on macOS (or the `ldid` utility on Linux). Otherwise the executable will be killed by the kernel and the end user has no way to permit it to run. `pkg` tries to ad-hoc sign the final executable. If necessary, replace this signature with your own trusted Apple Developer ID.

To build executables for all supported architectures and platforms from a single host, run `pkg` on a Linux host with binfmt (QEMU emulation) configured and `ldid` installed.

## Alpine / musl

The `alpine` platform targets glibc-less Alpine Linux / BusyBox environments. Use it for Alpine Docker images and similar musl-based distros. If you need a fully static binary that runs on any Linux kernel, prefer `linuxstatic`.

::: warning linuxstatic + native addons
Fully static Node binaries cannot load native bindings. If your project uses `.node` addons, `linuxstatic` will not work — use `linux` instead. See [Native addons](/guide/native-addons).
:::
