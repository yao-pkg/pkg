---
title: Packaged app usage
description: How a pkg-built executable behaves at runtime — argument forwarding, working directory, and process inspection.
---

# Packaged app usage

A packaged binary behaves almost identically to running your entry file under `node`. A command-line call to the packaged app `./app a b` is equivalent to `node app.js a b`.

## Forwarded arguments

Anything after the binary name reaches your code via `process.argv[2..]`:

```sh
./app --foo bar --debug
# process.argv → ['/abs/path/app', '/snapshot/project/app.js', '--foo', 'bar', '--debug']
```

Note that `process.argv[0]` is the path to the **binary itself** (not `node`), and `process.argv[1]` is the snapshot path of the entry file. See [Snapshot filesystem](/guide/snapshot-fs) for the full list of runtime path differences.

## Working directory

`process.cwd()` is the directory the user ran the binary from — just like `node`. This is **not** the `/snapshot/` path where your code lives. Use `process.cwd()` for user-facing file operations and `__dirname` for bundled resources.

## Detecting the pkg runtime

A `process.pkg` object exists when running inside a packaged binary:

```js
if (process.pkg) {
  console.log('packaged mode — entrypoint is', process.pkg.defaultEntrypoint);
} else {
  console.log('running under plain node');
}
```

Useful for switching between relative asset paths and snapshot paths in shared code.

## Standard streams

`stdin`, `stdout`, `stderr` behave identically to a regular Node.js process. Piping, redirection, TTY detection, and colours all work.

## Signals and exit codes

`process.exit()`, signal handlers (`SIGINT`, `SIGTERM`, …), and unhandled rejection behaviour are unchanged. The packaged binary propagates its final exit code to the shell.

## See also

- [Snapshot filesystem](/guide/snapshot-fs) — values of `__filename`, `__dirname`, `process.cwd()`, and friends at runtime
- [Detecting assets](/guide/detecting-assets)
- [Custom Node.js binary](/guide/custom-node)
