---
description: VFS, native addons, cross-compilation, ESM, and platform-specific notes
paths:
  - 'prelude/**'
  - 'lib/**'
---

# Platform & Virtual Filesystem

## VFS Path Handling

- Packaged apps use `/snapshot/` prefix (or `C:\snapshot\` on Windows).
- Use `__dirname`/`__filename` for snapshot files, `process.cwd()` for runtime fs.
- Path handling differs between packaged and non-packaged execution.

## Native Addons

- Extracted to `$HOME/.cache/pkg/` at runtime. Must match target Node.js version.
- `linuxstatic` target cannot load native bindings.
- Add `.node` files to `assets` if not detected automatically.

## Cross-Compilation

- Bytecode generation requires the target architecture binary.
- Use `--no-bytecode` for cross-arch builds.
- Linux: QEMU for emulation. macOS: Rosetta 2 for arm64 building x64.

## ESM

- Requires `--options experimental-require-module` on Node.js < 22.12.0.
- Check existing dictionary files for package-specific ESM handling.

## Platform Notes

- **Linux**: `linuxstatic` target for max portability.
- **macOS**: arm64 requires code signing (`codesign` or `ldid`).
- **Windows**: `.exe` extension required; native modules must match target arch.
