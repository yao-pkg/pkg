<p align="center">
  <img src="docs-site/public/logo.png" alt="pkg" width="140" />
</p>

<h1 align="center">pkg</h1>

<p align="center">
  <strong>Package your Node.js project into a single self-contained executable.</strong>
</p>

<p align="center">
  <a href="https://github.com/yao-pkg/pkg/actions/workflows/ci.yml"><img src="https://github.com/yao-pkg/pkg/actions/workflows/ci.yml/badge.svg" alt="Build Status" /></a>
  <a href="https://www.npmjs.com/package/@yao-pkg/pkg"><img src="https://img.shields.io/npm/v/@yao-pkg/pkg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@yao-pkg/pkg"><img src="https://img.shields.io/npm/dm/@yao-pkg/pkg" alt="npm downloads" /></a>
  <a href="https://github.com/yao-pkg/pkg/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@yao-pkg/pkg" alt="license" /></a>
</p>

<p align="center">
  <strong>📚 Full documentation: <a href="https://yao-pkg.github.io/pkg/">yao-pkg.github.io/pkg</a></strong>
</p>

---

`pkg` takes your Node.js project and ships it as a single binary that runs on devices without Node.js installed. Cross-compile for Linux, macOS, and Windows from any host.

## Install

```sh
npm install -g @yao-pkg/pkg
```

## Quick start

```sh
pkg .
```

That's it. `pkg` reads `package.json`, follows the `bin` entry, walks your dependencies, and produces executables for Linux, macOS, and Windows.

## Documentation

Everything lives on the docs site:

- **[Getting started](https://yao-pkg.github.io/pkg/guide/getting-started)** — install, CLI reference, first build
- **[Targets](https://yao-pkg.github.io/pkg/guide/targets)** — cross-compile for other platforms
- **[Configuration](https://yao-pkg.github.io/pkg/guide/configuration)** — `pkg` property in `package.json`, scripts, assets, ignore
- **[SEA vs Standard mode](https://yao-pkg.github.io/pkg/guide/sea-vs-standard)** — which packaging mode to pick and why
- **[Snapshot filesystem](https://yao-pkg.github.io/pkg/guide/snapshot-fs)** — how paths work at runtime
- **[Native addons](https://yao-pkg.github.io/pkg/guide/native-addons)**, **[ESM support](https://yao-pkg.github.io/pkg/guide/esm)**, **[API](https://yao-pkg.github.io/pkg/guide/api)**
- **[Troubleshooting](https://yao-pkg.github.io/pkg/guide/troubleshooting)**
- **[Architecture](https://yao-pkg.github.io/pkg/architecture)** — traditional mode vs enhanced SEA mode
- **[Contributing](https://yao-pkg.github.io/pkg/development)** — release process, running tests

## About this fork

This is **`yao-pkg/pkg`** — the actively maintained fork of the archived [`vercel/pkg`](https://github.com/vercel/pkg). New releases ship as [`@yao-pkg/pkg`](https://www.npmjs.com/package/@yao-pkg/pkg).

## License

[MIT](LICENSE)
