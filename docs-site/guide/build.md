---
title: Build from source
description: Compile Node.js base binaries from source instead of downloading pre-built ones from pkg-fetch.
---

# Build from source

`pkg` has so-called **base binaries** — Node.js executables with some patches applied. They're used as the starting point for every executable `pkg` creates. By default `pkg` downloads pre-compiled base binaries from [`pkg-fetch`](https://github.com/yao-pkg/pkg-fetch) before packaging your application.

If you prefer to compile base binaries from source, pass `--build`:

```sh
pkg --build index.js
```

::: warning Slow
Compiling a full Node.js binary takes **tens of minutes** on a fast machine and can easily hit hours on slower hardware. Only use `--build` when you actually need a custom compile.
:::

## Prerequisites

Your machine needs everything Node.js requires to compile from source. The authoritative list is in [nodejs/node/BUILDING.md](https://github.com/nodejs/node/blob/HEAD/BUILDING.md). At a minimum:

- A C/C++ toolchain (gcc, clang, or MSVC)
- Python 3
- GNU make or Ninja
- Several GB of free disk and memory

## When to build from source

- Targeting an architecture not in [`pkg-fetch` releases](https://github.com/yao-pkg/pkg-fetch/releases) and not in [`pkg-binaries`](https://github.com/yao-pkg/pkg-binaries)
- Applying your own patches on top of `pkg-fetch`'s patches
- Debugging a `pkg` issue that requires a custom Node.js build

Otherwise, stick with the default — downloaded binaries are faster, cached, and covered by CI.

::: tip Future direction
[SEA mode](/guide/sea-mode) removes the need for patched Node.js binaries entirely. See [SEA vs Standard](/guide/sea-vs-standard) and the [pkg-fetch elimination roadmap](/guide/sea-vs-standard#roadmap-killing-pkg-fetch). If you're reaching for `--build` because `pkg-fetch` doesn't cover your target, SEA may solve it upstream.
:::

## See also

- [Custom Node.js binary](/guide/custom-node)
- [Targets](/guide/targets)
- [pkg-fetch releases](https://github.com/yao-pkg/pkg-fetch/releases)
