# Build from source

`pkg` has so-called **base binaries** — they are `node` executables with some patches applied. They are used as a base for every executable `pkg` creates. By default `pkg` downloads pre-compiled base binaries before packaging your application.

If you prefer to compile base binaries from source instead of downloading them, pass the `--build` option to `pkg`. First, ensure your machine meets the requirements to compile original Node.js: [BUILDING.md](https://github.com/nodejs/node/blob/HEAD/BUILDING.md).

```sh
pkg --build index.js
```

See [pkg-fetch](https://github.com/yao-pkg/pkg-fetch) for more info on the patched Node.js binaries.

::: tip Future direction
SEA mode removes the need for patched Node.js binaries entirely. See [SEA vs Standard](/guide/sea-vs-standard) and the [pkg-fetch elimination roadmap](/guide/sea-vs-standard#roadmap-killing-pkg-fetch).
:::
