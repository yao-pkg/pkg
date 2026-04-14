---
title: SEA vs Standard
description: The full comparison between Standard mode (patched Node.js, bytecode, compression) and Enhanced SEA mode (stock Node.js, faster builds, zero patches).
---

# SEA vs Standard

`pkg` supports two packaging modes. The single biggest difference isn't a feature toggle — it's **what Node.js binary they run on**.

::: tip The core difference
**Standard mode** runs on a **custom-patched Node.js** binary distributed by [`pkg-fetch`](https://github.com/yao-pkg/pkg-fetch). Every Node.js release requires ~600–850 lines of patches across ~25 files to be rebased, rebuilt, and re-released.

**SEA mode** runs on **stock, unmodified Node.js**. No patches. No waiting for `pkg-fetch` to catch up. Security fixes and new Node versions are available the moment Node.js itself releases them.
:::

Everything else — compression, bytecode, worker threads, native addons — flows from that one decision.

## Why stock binaries matter

- **Security posture** — stock Node.js is auditable, signed by the Node.js project, and tracked by every vulnerability scanner. A patched fork isn't.
- **Supply chain** — fewer custom binaries in the dependency graph, fewer things to trust.
- **Release cadence** — the day Node.js 24.x ships a security fix, SEA-built apps can rebuild against it. Standard mode has to wait for `pkg-fetch` to rebase, rebuild, and publish.
- **Maintenance burden** — the ~600–850 lines of patches per Node release are the single biggest maintenance cost in this project. SEA eliminates that cost.
- **Future-proofing** — SEA is an **official Node.js API**. It will keep working as Node.js evolves. Patched builds are always one compiler change away from breaking.

## Feature matrix

| Feature                         | **Standard**                   | **Enhanced SEA**         |
| ------------------------------- | ------------------------------ | ------------------------ |
| **Node.js binary**              | Custom patched (`pkg-fetch`)   | **Stock Node.js** ✨     |
| Source protection (V8 bytecode) | ✅                             | ❌ plaintext             |
| Compression (Brotli / GZip)     | ✅                             | ❌                       |
| Build speed                     | Slower                         | **Faster**               |
| Cross-compile                   | ✅                             | ✅                       |
| Worker threads                  | ✅                             | ✅                       |
| Native addons                   | ✅                             | ✅                       |
| ESM + top-level await           | Partial                        | ✅ every target          |
| Maintenance burden              | High — patch each Node release | **Low — stock binaries** |
| Security updates                | Wait for `pkg-fetch` rebuild   | **Immediate**            |
| Future path                     | Tied to `pkg-fetch`            | Migrates to `node:vfs`   |

## When to pick which

Pick **Standard** when:

- You need **source protection** — your IP must not ship as plaintext JavaScript.
- You need **compression** — binary size matters more than build speed.

Pick **SEA** when:

- You don't need bytecode protection (most CLI tools, internal services, open-source apps).
- You want **faster builds**.
- You want to **stay on the latest Node.js** without waiting for `pkg-fetch`.
- You care about **supply-chain simplicity** — stock, signed, auditable binaries.

For new projects where bytecode IP protection isn't a hard requirement, **SEA is the recommended default going forward**.

## Roadmap

Long-term goal: eliminate patched Node.js binaries entirely and ship `pkg` on stock Node via SEA + `node:vfs`. Progress, patch categorisation, and upstream strategy are tracked in **[#231](https://github.com/yao-pkg/pkg/issues/231)**.
