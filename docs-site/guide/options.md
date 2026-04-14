---
title: CLI options (baked)
description: Bake Node.js and V8 command-line options into your packaged executable so users always get the right flags.
---

# Baked CLI options

Node.js applications can be launched with runtime options belonging to Node.js or V8 — `--max-old-space-size`, `--expose-gc`, `--tls-min-v1.0`, and friends. To list the full set, run `node --help` or `node --v8-options`.

You can **bake** these runtime options into the packaged executable. The app will always run with the options turned on, even when the end user launches it without any flags. Just drop the leading `--` from each option name.

## Syntax

Join multiple options with commas, no spaces:

```sh
pkg app.js --options expose-gc
pkg app.js --options max_old_space_size=4096
pkg app.js --options max-old-space-size=1024,tls-min-v1.0,expose-gc
```

Or set `pkg.options` in `package.json`:

```json
{
  "pkg": {
    "options": "max-old-space-size=2048,expose-gc"
  }
}
```

## Common use cases

| Option                        | Why bake it                                            |
| ----------------------------- | ------------------------------------------------------ |
| `max-old-space-size=N`        | Raise the V8 heap ceiling for memory-heavy CLI tools   |
| `expose-gc`                   | Let the app call `global.gc()` for manual collection   |
| `tls-min-v1.0`                | Accept legacy TLS — interop with old internal services |
| `unhandled-rejections=strict` | Turn unhandled promise rejections into hard crashes    |
| `enable-source-maps`          | Produce meaningful stack traces in production          |

::: tip Pass-through vs baked
Baked options **always** apply. End users can't turn them off. If you want users to override, don't bake — document the flag in your `--help` and let them pass it.
:::

## See also

- [Getting started → CLI reference](/guide/getting-started#cli-reference)
- [Environment variables](/guide/environment)
