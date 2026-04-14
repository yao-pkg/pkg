---
title: Migration from vercel/pkg
description: How to switch from the archived vercel/pkg to the maintained yao-pkg/pkg fork — drop-in rename, differences, and compatibility notes.
---

# Migration from `vercel/pkg`

[`vercel/pkg`](https://github.com/vercel/pkg) was **archived** in January 2024 and no longer receives updates. [`yao-pkg/pkg`](https://github.com/yao-pkg/pkg) is the actively maintained fork and the recommended path forward.

For the vast majority of projects, **migration is a one-line dependency rename** — nothing else changes.

## TL;DR

::: code-group

```sh [npm]
npm uninstall pkg
npm install --save-dev @yao-pkg/pkg
```

```sh [pnpm]
pnpm remove pkg
pnpm add -D @yao-pkg/pkg
```

```sh [yarn]
yarn remove pkg
yarn add -D @yao-pkg/pkg
```

:::

Update any `package.json` scripts that called the bin:

```diff
 {
   "scripts": {
-    "build": "pkg ."
+    "build": "pkg ."
   },
   "devDependencies": {
-    "pkg": "^5.8.1",
+    "@yao-pkg/pkg": "^6.15.0"
   }
 }
```

The CLI name (`pkg`) is unchanged — only the npm package name differs. All existing `pkg .`, `pkg index.js`, `pkg -t ...` commands keep working.

## What's different

### Node.js version support

| Fork          | Supported Node.js versions                         |
| ------------- | -------------------------------------------------- |
| `vercel/pkg`  | 12, 14, 16, 18                                     |
| `yao-pkg/pkg` | **22, 24** (Node >= 22 required on the build host) |

`yao-pkg/pkg` drops the older EOL Node.js versions and keeps pace with upstream LTS. If you were packaging `node18-...` binaries with `vercel/pkg`, you'll need to update your `targets` to `node22-...` or `node24-...`.

### New features beyond `vercel/pkg`

- **SEA mode** — [stock Node.js packaging](/guide/sea-mode) via the official Single Executable Applications API. No patched Node.js.
- **Enhanced SEA** — full dependency walker + VFS on top of SEA. ESM with top-level await works everywhere. See [SEA vs Standard](/guide/sea-vs-standard).
- **Improved ESM** — most ESM features work transparently now, no manual transform needed. See [ESM support](/guide/esm).
- **Active bug fixes** — regular releases, responsive issue triage, up-to-date base binaries via [`pkg-fetch`](https://github.com/yao-pkg/pkg-fetch).
- **Workers + native addons** work in both standard and SEA modes.

### Breaking changes from `vercel/pkg@5.x`

For 99% of projects, **none**. The CLI, `package.json` config schema, and API are source-compatible.

If you hit a corner case:

- Dropped Node.js 12 / 14 / 16 / 18 targets — update to `node22` or `node24`.
- The `public` / `public-packages` semantics are unchanged, but `--no-bytecode` now requires explicit `--public-packages` if your deps have non-SPDX licenses. This was already the case in `vercel/pkg`, but the enforcement is stricter.
- A few internal APIs under `lib/` have been refactored. If you were importing deep paths instead of the documented `{ exec }` entry point, you may need to adjust. See [API](/guide/api) for the stable surface.

## Verify the migration

```sh
pkg --version   # should print a 6.x version
pkg .           # or your existing command
```

If the build succeeds and the output runs the same as before, you're done.

## Running into trouble?

- **CLI hangs on first run.** That's `pkg-fetch` downloading a fresh base binary on the first build for the new fork. Let it finish; subsequent builds hit the cache.
- **Error about missing target.** Check your target against `pkg-fetch` releases — older Node.js versions may no longer be built.
- **Anything else.** Open an issue on [yao-pkg/pkg](https://github.com/yao-pkg/pkg/issues) with a reproduction; maintainers actively triage.

## See also

- [Getting started](/guide/getting-started)
- [SEA vs Standard](/guide/sea-vs-standard) — the biggest new feature since `vercel/pkg`
- [pkg-fetch](https://github.com/yao-pkg/pkg-fetch) — where the base binaries come from
