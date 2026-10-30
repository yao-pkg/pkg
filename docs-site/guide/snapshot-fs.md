---
title: Snapshot filesystem
description: How paths work inside a packaged pkg binary — /snapshot prefix, __dirname, __filename, process.cwd, and friends.
---

# Snapshot filesystem

During the packaging process `pkg` collects project files and places them into the executable. This bundle is called a **snapshot**. At run time the packaged application has access to a snapshot filesystem where all those files reside.

Packaged files have a `/snapshot/` prefix in their paths (or `C:\snapshot\` on Windows). If you used `pkg /path/app.js`, then at runtime `__filename` is likely `/snapshot/path/app.js`, and `__dirname` is `/snapshot/path`.

## Path values at runtime

Comparison of path-related values when running your code under plain `node` versus inside a packaged binary:

| value                           | with `node`       | packaged                   | comments                                                 |
| ------------------------------- | ----------------- | -------------------------- | -------------------------------------------------------- |
| `__filename`                    | `/project/app.js` | `/snapshot/project/app.js` |                                                          |
| `__dirname`                     | `/project`        | `/snapshot/project`        |                                                          |
| `process.cwd()`                 | `/project`        | `/deploy`                  | suppose the app is called `app-x64` and run in `/deploy` |
| `process.execPath`              | `/usr/bin/nodejs` | `/deploy/app-x64`          |                                                          |
| `process.argv[0]`               | `/usr/bin/nodejs` | `/deploy/app-x64`          |                                                          |
| `process.argv[1]`               | `/project/app.js` | `/snapshot/project/app.js` |                                                          |
| `process.pkg.entrypoint`        | `undefined`       | `/snapshot/project/app.js` |                                                          |
| `process.pkg.defaultEntrypoint` | `undefined`       | `/snapshot/project/app.js` |                                                          |
| `require.main.filename`         | `/project/app.js` | `/snapshot/project/app.js` |                                                          |

## Rules of thumb

- To use a file collected **at packaging time** (`require` a JavaScript file or serve an asset), take `__filename`, `__dirname`, `process.pkg.defaultEntrypoint`, or `require.main.filename` as a base for your path calculations.
- For JavaScript files you can just `require` or `require.resolve` because they use the current `__dirname` by default.
- For assets, use `path.join(__dirname, '../path/to/asset')` — see [Detecting assets](/guide/detecting-assets) for how `pkg` picks those up statically.
- To access the **real filesystem at run time** — pick up a user's external JS plugin, JSON config, or list a user's directory — use `process.cwd()` or `path.dirname(process.execPath)`.

## Quick example

```js
const fs = require('fs');
const path = require('path');

// bundled asset (resolved inside /snapshot)
const template = fs.readFileSync(
  path.join(__dirname, 'templates/greeting.html'),
  'utf8',
);

// real config file next to the binary at runtime
const configPath = path.join(path.dirname(process.execPath), 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
```

## Symlinks

Symlinks collected into the snapshot (pnpm and workspace `node_modules`, `node_modules/.bin`, links among your assets) behave as they do outside the binary:

```js
fs.lstatSync(link).isSymbolicLink(); // true
fs.readdirSync(dir, { withFileTypes: true }); // links report isSymbolicLink()
fs.readlinkSync(link); // '/snapshot/app/node_modules/.pnpm/x/node_modules/x'
```

`readlink` returns the absolute target inside the snapshot, not the relative link body on disk.

::: warning Changed in the next major
Before, links looked like the file or directory they point at. Code that finds entries with `d.isDirectory()` or `d.isFile()` now skips linked ones, the same as plain Node. Check `d.isSymbolicLink()` and `fs.statSync()` the entry, or pass `follow: true` to `glob`. fast-glob and readdirp follow links by default.
:::

See [symlink semantics](https://github.com/yao-pkg/pkg/blob/main/docs/ARCHITECTURE.md#symlink-semantics-in-packaged-binaries) for the details.

## Detecting that you're packaged

Check for `process.pkg`:

```js
if (process.pkg) {
  // running inside a pkg binary
}
```

## See also

- [Packaged app usage](/guide/packaged-app)
- [Detecting assets](/guide/detecting-assets)
- [Debug virtual FS](/guide/advanced-debug-vfs)
