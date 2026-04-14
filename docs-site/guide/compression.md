---
title: Compression
description: Shrink the embedded filesystem inside your pkg binary with Brotli or GZip.
---

# Compression

Pass `--compress Brotli` or `--compress GZip` to compress the contents of files stored in the executable. `-C` is a shortcut for `--compress`.

::: code-group

```sh [Brotli (smaller)]
pkg --compress Brotli index.js
```

```sh [GZip (faster to decompress)]
pkg -C GZip index.js
```

```json [package.json]
{
  "pkg": {
    "compress": "Brotli"
  }
}
```

:::

## How much does it save?

This option can reduce the size of the embedded filesystem by up to **60%**. The exact ratio depends on your project — heavy JavaScript (libraries with long variable names) compresses well, already-minified code less so.

The startup time of the application may actually be **slightly reduced** — smaller disk reads often outweigh the decompression cost.

## Brotli vs GZip

| Algorithm | Compression ratio | Decompression speed | Use when                        |
| --------- | ----------------- | ------------------- | ------------------------------- |
| Brotli    | Higher            | Slower              | Binary size matters most        |
| GZip      | Lower             | Faster              | Cold-start latency matters most |

For most CLI tools, Brotli is the better default. For long-running services where the extra MB or two doesn't matter, GZip shaves a few ms off startup.

## SEA mode

::: warning Not supported in SEA mode
Compression is **not** available when packaging with `--sea`. The SEA binary layout uses a flat blob without per-file compression. If binary size is critical, stick with Standard mode. See [SEA vs Standard](/guide/sea-vs-standard).
:::

## Troubleshooting

If the compressed binary fails to start with a corruption error, try rebuilding without compression first to isolate the cause. Large files (multi-MB assets) can trip edge cases; `--debug` + `DEBUG_PKG=1` will show you the snapshot tree.

## See also

- [Bytecode](/guide/bytecode)
- [Targets](/guide/targets)
- [Output & debug](/guide/output)
