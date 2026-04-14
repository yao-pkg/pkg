---
layout: home

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
    details: Build Linux, macOS, and Windows binaries from any host. x64 and arm64 supported out of the box.
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

<div style="max-width: 960px; margin: 3rem auto 0; padding: 0 1.5rem;">

## Quick install

```sh
npm install -g @yao-pkg/pkg
```

## Your first binary

```sh
pkg .
```

That's it. `pkg` reads `package.json`, follows the `bin` entry, walks your dependencies, and spits out executables for Linux, macOS, and Windows.

Want to target a specific platform?

```sh
pkg -t node22-linux-arm64 index.js
```

## Why pkg?

- **Commercial apps** — ship without sources
- **CLI tools** — distribute a single binary, no npm install on user machines
- **Demos & trials** — no runtime, no dependencies to break
- **Self-extracting installers** — one file, portable
- **Edge & containers** — smaller, faster deploys

See the [full use cases](/guide/) →

</div>
