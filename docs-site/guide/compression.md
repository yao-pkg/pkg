---
title: Compression
description: Shrink the embedded filesystem inside your pkg binary with Brotli, GZip or Zstd.
---

# Compression

Pass `--compress Brotli`, `--compress GZip`, or `--compress Zstd` to compress the contents of files stored in the executable. `-C` is a shortcut for `--compress`.

::: code-group

```sh [Zstd (best balance)]
pkg --compress Zstd index.js
```

```sh [Brotli (smallest)]
pkg --compress Brotli index.js
```

```sh [GZip (widely compatible)]
pkg -C GZip index.js
```

```json [package.json]
{
  "pkg": {
    "compress": "Zstd"
  }
}
```

:::

## How much does it save?

This option can reduce the size of the embedded filesystem by **60-70%** on typical Node.js projects. The exact ratio depends on your project — heavy JavaScript (libraries with long variable names) compresses well, already-minified code less so.

The startup time of the application may actually be **slightly reduced** — smaller disk reads often outweigh the decompression cost, especially with Zstd.

## Choosing an algorithm

| Algorithm | Compression ratio | Decompression speed | Use when                                            |
| --------- | ----------------- | ------------------- | --------------------------------------------------- |
| Brotli    | Highest           | Slowest             | Binary size is the only thing that matters          |
| Zstd      | High              | Very fast           | Balanced default — small binary and fast cold start |
| GZip      | Lower             | Fast                | Older Node.js runtimes without Zstd support         |

For most projects, **Zstd** is the best default — near-Brotli ratios with GZip-class decompression speed.

::: info Zstd availability
Zstd uses `node:zlib`'s `zstdCompress` / `zstdDecompress`, which were added in **Node.js 22.15.0**. The build host and the packaged Node runtime must both support it. Use Brotli if you need to target older Node 22.x releases.
:::

## SEA mode

Compression also works with `--sea`. The SEA archive is compressed per-file at build time and decompressed lazily on first `fs.readFileSync` / `require()` at runtime, so only files you actually access pay the decompression cost.

```sh
pkg --sea --compress Zstd index.js
```

This closes most of the size gap between SEA-mode and Standard-mode binaries without a measurable cold-start regression for typical CLIs.

## Troubleshooting

If the compressed binary fails to start with a corruption error, try rebuilding without compression first to isolate the cause. Large files (multi-MB assets) can trip edge cases; `--debug` + `DEBUG_PKG=1` will show you the snapshot tree.

## See also

- [Bytecode](/guide/bytecode)
- [Targets](/guide/targets)
- [Output & debug](/guide/output)
