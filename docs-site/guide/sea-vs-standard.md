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

## Roadmap: killing `pkg-fetch`

The long-term goal is to eliminate the need for patched Node.js binaries **entirely**. Tracked in **[yao-pkg/pkg#231](https://github.com/yao-pkg/pkg/issues/231)**.

Every `pkg-fetch` patch falls into 9 conceptual categories. Most of them can be eliminated by landing changes upstream in Node.js core. Here's the current plan:

| #   | Patch category                       | Eliminated by                                                                   |
| --- | ------------------------------------ | ------------------------------------------------------------------------------- |
| 1   | Binary entrypoint injection (BAKERY) | **SEA mode** (already available)                                                |
| 2   | Bootstrap / prelude loader           | **`node:vfs`** ([nodejs/node#61478](https://github.com/nodejs/node/pull/61478)) |
| 3   | VFS interception in module loader    | **`node:vfs`** ([nodejs/node#61478](https://github.com/nodejs/node/pull/61478)) |
| 4   | V8 sourceless bytecode               | RFC for upstream bytecode-only execution mode                                   |
| 5   | SIGUSR1 removal                      | `--disable-inspector` configure flag                                            |
| 6   | Debug options disabled               | `--disable-inspector` configure flag                                            |
| 7   | Process init guards                  | **`node:vfs`** ([nodejs/node#61478](https://github.com/nodejs/node/pull/61478)) |
| 8   | `child_process.fork()` bug           | One-line upstream bug fix PR                                                    |
| 9   | Build system fixes                   | Individual small PRs for each fix                                               |

### Upstream strategy

**Tier 1 — submit now** (high acceptance, low risk)

- `child_process.fork()` bug fix — one-line PR
- Build fixes — small PRs for each

**Tier 2 — help land the VFS PR** (highest impact)

- Help rebase [nodejs/node#61478](https://github.com/nodejs/node/pull/61478)
- Fix worker-thread VFS inheritance
- Contribute SEA-specific tests
- Help close remaining items in [nodejs/node#62328](https://github.com/nodejs/node/issues/62328)

Landing VFS alone eliminates patches **2, 3, 7** and reduces the need for patch **1**.

**Tier 3 — RFC for V8 sourceless bytecode** (high impact, needs socialisation)

- Write an RFC for bytecode-only execution mode
- Socialise in `nodejs/node` discussions
- Submit a PR if the RFC is accepted

Eliminates patch **4** — the most complex and fragile of the bunch.

**Tier 4 — configure flags** (lower priority)

- Propose `--disable-inspector` configure flag (or rely on SEA's existing inspector restrictions)

Eliminates patches **5, 6**.

### End state

**Zero patches. `pkg` uses stock Node.js binaries via SEA + `node:vfs`.**

This is an ongoing effort. Follow progress, comment, or contribute on **[#231](https://github.com/yao-pkg/pkg/issues/231)**.
