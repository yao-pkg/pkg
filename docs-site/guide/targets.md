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

Tracked in [#87](https://github.com/yao-pkg/pkg/issues/87) and [#181](https://github.com/yao-pkg/pkg/issues/181). Three workarounds:

1. **Switch to SEA** — `pkg . --sea`. Avoids the V8 bytecode step entirely.
2. **Disable bytecode** — `pkg . --no-bytecode --public-packages "*" --public`. Keeps Standard mode, stores source as plaintext.
3. **Fallback to source** — `pkg . --fallback-to-source`. Keeps bytecode for files that compile successfully and ships the rest as plain source. See [Bytecode → Fallback to source](/guide/bytecode#fallback-to-source-on-failure).
4. **Target Node 24** — the regression is gone on `node24-*` targets.

:::

### Bytecode and target arch

Regardless of the bug above, the V8 bytecode fabricator in Standard mode needs to execute code compiled for the **target** arch at build time. If the host arch differs from the target:

- **Linux** — configure binfmt with [QEMU](https://wiki.debian.org/QemuUserEmulation)
- **macOS** — you can build `x64` on `arm64` with Rosetta 2, but not the opposite
- **Windows** — you can build `x64` on `arm64` with x64 emulation, but not the opposite
- Or disable bytecode generation entirely with `--no-bytecode --public-packages "*" --public`
- Or use `--fallback-to-source` to ship only the failing files as plain source while keeping bytecode for the rest

Enhanced SEA doesn't have this limitation when the host and target share the same Node major: pkg uses `process.execPath` to generate the SEA blob, so no target-arch interpreter is needed. Cross-major SEA builds (e.g. building `node22-*` targets on a Node 24 host) still require an interpreter for the downloaded target binary.

## macOS arm64

`macos-arm64` is experimental. Be careful about the [mandatory code signing requirement](https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes). The final executable has to be signed (an ad-hoc signature is sufficient) with the `codesign` utility on macOS (or the `ldid` utility on Linux). Otherwise the executable will be killed by the kernel and the end user has no way to permit it to run. `pkg` tries to ad-hoc sign the final executable. If necessary, replace this signature with your own trusted Apple Developer ID.

To build executables for all supported architectures and platforms from a single host, run `pkg` on a Linux host with binfmt (QEMU emulation) configured and `ldid` installed.

## Alpine / musl

The `alpine` platform targets glibc-less Alpine Linux / BusyBox environments. Use it for Alpine Docker images and similar musl-based distros. If you need a fully static binary that runs on any Linux kernel, prefer `linuxstatic`.

::: warning linuxstatic + native addons
Fully static Node binaries cannot load native bindings. If your project uses `.node` addons, `linuxstatic` will not work — use `linux` instead. See [Native addons](/guide/native-addons).
:::
