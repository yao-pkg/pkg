---
title: Bytecode
description: V8 bytecode compilation in pkg — why it exists, when to disable it, and how it interacts with reproducible builds and licensing.
---

# Bytecode

By default, your source code is precompiled to **V8 bytecode** before being written to the output file. This strips the original JavaScript source from the binary, making it harder (though not impossible) to recover. Disable with `--no-bytecode`.

```sh
pkg --no-bytecode index.js
```

## Why bytecode is on by default

- **Source obscurity.** With `--no-bytecode`, raw JavaScript is embedded directly. On a \*nix machine, `pkg` a project with `--no-bytecode` and run GNU `strings` on the output — you can grep your source. Bytecode doesn't make it _secure_, but it adds a layer of friction that deters casual reverse engineering.
- **Faster startup.** V8 can skip parsing and directly execute the bytecode.

## Why you might disable it

### Reproducible builds

V8 bytecode compilation is not deterministic (see [this paper](https://ui.adsabs.harvard.edu/abs/2019arXiv191003478C/abstract) and [this post](https://medium.com/dailyjs/understanding-v8s-bytecode-317d46c94775)) — different runs produce different bytecode for the same input. If you need reproducible executable hashes (md5, sha256, …) across builds, disable bytecode:

```sh
pkg --no-bytecode --public-packages "*" index.js
```

### Cross-compiling without QEMU

Bytecode generation requires running the **target** architecture's Node.js to compile the code. On Linux that means binfmt + QEMU for foreign arches. If you don't want to set that up, disabling bytecode avoids the requirement entirely:

```sh
pkg --no-bytecode --public-packages "*" --public -t node22-linux-arm64 index.js
```

See [Targets → Cross-compilation support](/guide/targets#cross-compilation-support).

## Licenses and `--public-packages`

Disabling bytecode fails if any package in your project isn't explicitly marked as public via `license` in its `package.json`. `pkg` checks the license of each package and makes sure that non-public code is only included **as bytecode** — this is a legal safety net for proprietary dependencies.

Override this behaviour by whitelisting packages:

```sh
pkg --no-bytecode --public-packages "packageA,packageB" index.js
```

Or mark all packages as public:

```sh
pkg --no-bytecode --public-packages "*" --public index.js
```

`--public` additionally exposes the **top-level project** sources (i.e. your own code) as plain text.

## Fallback to source on failure

When bytecode generation fails for a specific file (e.g. during cross-compilation without QEMU), `pkg` logs a warning and **skips the file** — it won't be available at runtime. If you'd rather ship the affected files as plain source instead of skipping them, pass `--fallback-to-source`:

```sh
pkg --fallback-to-source -t node22-linux-arm64 index.js
```

Files that compile successfully still ship as bytecode; only the ones that fail are included as plain JavaScript. A warning is emitted for each file that falls back.

## SEA mode

SEA mode **never uses bytecode**. Source is always plaintext in a SEA binary. This is a deliberate trade-off — see [SEA vs Standard](/guide/sea-vs-standard).

## See also

- [Compression](/guide/compression)
- [Targets](/guide/targets)
- [SEA vs Standard](/guide/sea-vs-standard)
