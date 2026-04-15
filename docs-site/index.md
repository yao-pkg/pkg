---
layout: home
title: pkg — Node.js to single executable
description: Ship your Node.js project as one self-contained binary. No runtime install. No npm. Cross-compiled for Linux, macOS, and Windows.

hero:
  name: pkg
  text: Node.js to single executable
  tagline: Ship your Node.js project as one self-contained binary. No runtime install. No npm. Just run.
  image:
    src: /logo.png
    alt: pkg
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: SEA vs Standard
      link: /guide/sea-vs-standard
    - theme: alt
      text: View on GitHub
      link: https://github.com/yao-pkg/pkg

features:
  - icon: 📦
    title: Single file deploy
    details: One binary per target. No Node.js install, no node_modules, no dependency churn on the deployment host.
  - icon: 🌍
    title: Cross-compile
    details: Build Linux, macOS, and Windows binaries for x64 and arm64 from a single host. Works out of the box on Node 20 and 24; Node 22 needs --sea or --public.
  - icon: 🔒
    title: Source protection
    details: V8 bytecode compilation keeps your source out of the final binary. Optional Brotli and GZip compression shrinks it further.
  - icon: ⚡
    title: Native addons
    details: .node files are detected, extracted, and loaded transparently at runtime. Works with the bindings package.
  - icon: 🧩
    title: Virtual filesystem
    details: Your project files live inside the binary under /snapshot/. require, fs, and path all Just Work.
  - icon: 🚀
    title: SEA mode
    details: Opt into Node.js Single Executable Applications for stock-binary packaging. No patched Node.js, faster builds.
---

<div class="fork-banner">
<strong>Looking for <code>vercel/pkg</code>?</strong> This is <a href="https://github.com/yao-pkg/pkg"><code>yao-pkg/pkg</code></a> — the actively maintained fork. The original <code>vercel/pkg</code> is archived. <code>@yao-pkg/pkg</code> is a drop-in replacement — rename the dep and keep shipping. See the <a href="/pkg/guide/migration">migration guide</a>.
</div>

<div class="landing-badges">

[![npm version](https://img.shields.io/npm/v/@yao-pkg/pkg?color=e89b2c&label=npm)](https://www.npmjs.com/package/@yao-pkg/pkg) [![npm downloads](https://img.shields.io/npm/dm/@yao-pkg/pkg?color=e89b2c&label=downloads)](https://www.npmjs.com/package/@yao-pkg/pkg) [![GitHub stars](https://img.shields.io/github/stars/yao-pkg/pkg?color=e89b2c&label=stars)](https://github.com/yao-pkg/pkg/stargazers) [![CI](https://github.com/yao-pkg/pkg/actions/workflows/ci.yml/badge.svg)](https://github.com/yao-pkg/pkg/actions/workflows/ci.yml) [![license](https://img.shields.io/npm/l/@yao-pkg/pkg?color=e89b2c)](https://github.com/yao-pkg/pkg/blob/main/LICENSE)

</div>

<figure class="landing-demo">
  <img src="/hero.gif" alt="Terminal recording: pkg index.js produces linux, macos, and windows binaries in one second" />
  <figcaption>One command. Three binaries. Runs on machines without Node.js installed.</figcaption>
</figure>

<div class="landing-body">

## Quick install

```sh
npm install -g @yao-pkg/pkg
```

Requires **Node.js >= 22** on the build host.

## Your first binary

::: code-group

```sh [CLI, entry file]
pkg index.js
```

```sh [CLI, package.json]
pkg .
```

```js [Node.js API]
const { exec } = require('@yao-pkg/pkg');
await exec(['index.js', '--target', 'host', '--output', 'app']);
```

:::

`pkg` reads `package.json`, follows the `bin` entry, walks your dependencies, and produces executables for Linux, macOS, and Windows.

Want to target a specific platform?

```sh
pkg -t node22-linux-arm64 index.js
```

## Standard or SEA?

Two build modes: **Standard** (`pkg .`) gives you bytecode protection and compression; **Enhanced SEA** (`pkg . --sea`) runs on stock Node.js with no patches. Pick via [SEA vs Standard](/guide/sea-vs-standard).

## Why pkg?

- **Commercial apps** — ship without sources
- **CLI tools** — distribute one binary, no npm install on user machines
- **Demos & trials** — no runtime, no dependencies to break
- **Self-extracting installers** — one file, portable
- **Edge & containers** — smaller, faster deploys

See the [full use cases](/guide/) →

</div>
