# Exploring the virtual filesystem in debug mode

When you use the `--debug` flag while building your executable, `pkg` adds the ability to display the content of the virtual filesystem and the symlink table on the console when the application starts, provided the `DEBUG_PKG` environment variable is set.

This feature is useful to inspect whether symlinks are correctly handled and to check that all required files are properly included in the final executable.

```bash
pkg --debug app.js -o output
DEBUG_PKG=1 ./output
```

On Windows:

```bat
C:\> pkg --debug app.js -o output.exe
C:\> set DEBUG_PKG=1
C:\> output.exe
```

::: warning
Do not use the `--debug` flag in production builds.
:::
