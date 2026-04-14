# Compression

Pass `--compress Brotli` or `--compress GZip` to compress the content of files stored in the executable.

This option can reduce the size of the embedded filesystem by up to **60%**. The startup time of the application may be slightly reduced as well (smaller disk reads).

`-C` is a shortcut for `--compress`.

```sh
pkg --compress Brotli index.js
pkg -C GZip index.js
```

::: warning SEA mode
Compression is **not** supported in SEA mode. See [SEA vs Standard](/guide/sea-vs-standard).
:::
