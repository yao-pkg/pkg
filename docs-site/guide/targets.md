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

## Cross-compilation notes

By default `pkg` has to run the executable of the **target** arch to generate bytecode:

- **Linux** — configure binfmt with [QEMU](https://wiki.debian.org/QemuUserEmulation)
- **macOS** — you can build `x64` on `arm64` with Rosetta 2, but not the opposite
- **Windows** — you can build `x64` on `arm64` with x64 emulation, but not the opposite
- Or disable bytecode generation entirely with `--no-bytecode --public-packages "*" --public`

## macOS arm64

`macos-arm64` is experimental. Be careful about the [mandatory code signing requirement](https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes). The final executable has to be signed (an ad-hoc signature is sufficient) with the `codesign` utility on macOS (or the `ldid` utility on Linux). Otherwise the executable will be killed by the kernel and the end user has no way to permit it to run. `pkg` tries to ad-hoc sign the final executable. If necessary, replace this signature with your own trusted Apple Developer ID.

To build executables for all supported architectures and platforms from a single host, run `pkg` on a Linux host with binfmt (QEMU emulation) configured and `ldid` installed.

## Alpine / musl

The `alpine` platform targets glibc-less Alpine Linux / BusyBox environments. Use it for Alpine Docker images and similar musl-based distros. If you need a fully static binary that runs on any Linux kernel, prefer `linuxstatic`.

::: warning linuxstatic + native addons
Fully static Node binaries cannot load native bindings. If your project uses `.node` addons, `linuxstatic` will not work — use `linux` instead. See [Native addons](/guide/native-addons).
:::
