---
title: What is pkg?
description: pkg packages Node.js projects into single self-contained executables for Linux, macOS, and Windows — no runtime install required on the target machine.
---

# What is pkg?

`pkg` is a command-line tool that packages your Node.js project into a **single self-contained executable**. The resulting binary runs on devices that don't have Node.js installed, ship no `node_modules`, and boot like any other native CLI tool.

## Use cases

- Make a commercial version of your application without sources
- Make a demo, evaluation, or trial version of your app without sources
- Instantly make executables for other platforms (cross-compilation)
- Make a self-extracting archive or installer
- Skip installing Node.js and npm on the deployment target
- Deploy a single file instead of hundreds of `npm install` artifacts
- Put your assets inside the executable to make it even more portable
- Test your app against a new Node.js version without installing it

## Two packaging modes

`pkg` builds executables in either **Standard** mode (patched Node.js, bytecode, compression) or **Enhanced SEA** mode (stock Node.js via the [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) API). See **[SEA vs Standard](/guide/sea-vs-standard)** to pick.

## How it works

```mermaid
flowchart LR
    A[Your Node.js project] --> B[pkg walker]
    B --> C[Bundled payload]
    C --> D{Mode}
    D -- Standard --> E[Patched Node.js + custom VFS]
    D -- Enhanced SEA --> F[Stock Node.js + NODE_SEA_BLOB]
    E --> G[Single executable]
    F --> G

    style A stroke:#e89b2c,stroke-width:2px
    style G stroke:#66bb6a,stroke-width:2px
```

The walker follows `require` / `import` from your entry file, pulls in every dependency, optionally compiles JavaScript to V8 bytecode (Standard) or keeps source (SEA), and injects the whole bundle into a Node.js binary.

Want the full story? See [Architecture](/architecture).

## Next steps

- [Getting started](/guide/getting-started) — install and build your first binary
- [Targets](/guide/targets) — cross-compile for other platforms
- [Configuration](/guide/configuration) — scripts, assets, and the `pkg` property in `package.json`
- [SEA vs Standard](/guide/sea-vs-standard) — which mode to pick
- [Recipes](/guide/recipes) — copy-paste solutions
- [Migration from vercel/pkg](/guide/migration)
