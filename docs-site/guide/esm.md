---
title: ESM support
description: Package projects that use ECMAScript modules — imports, exports, top-level await, and import.meta.
---

# ECMAScript Modules (ESM)

Starting from version **6.13.0**, `pkg` has improved support for ECMAScript Modules. Most ESM features are automatically transformed to CommonJS during packaging.

## Supported ESM features

- **`import` and `export` statements** — automatically transformed to `require()` and `module.exports`
- **Top-level `await`** — wrapped in an async IIFE to work in a CommonJS context
- **Top-level `for await...of`** — wrapped in an async IIFE to work in a CommonJS context
- **`import.meta.url`** — polyfilled to provide the file URL of the current module
- **`import.meta.dirname`** — polyfilled to provide the directory path (Node.js 20.11+ property)
- **`import.meta.filename`** — polyfilled to provide the file path (Node.js 20.11+ property)

## Known limitations

1. **Modules with both top-level await and exports** — modules that use `export` statements alongside top-level `await` cannot be wrapped in an async IIFE and will not be transformed to bytecode. They are included as source code instead.
2. **`import.meta.main`** and other custom properties — only the standard `import.meta` properties listed above are polyfilled. Custom properties added by your code or other tools may not work as expected.
3. **Dynamic imports** — `import()` expressions work but may have limitations depending on the module being imported.

## Best practices

- For **entry-point scripts** (the main file you're packaging), feel free to use top-level await.
- For **library modules** that will be imported by other code, avoid using both exports and top-level await together.
- Test your packaged executable to ensure all ESM features work as expected in your specific use case.

::: tip Enhanced SEA mode
In [Enhanced SEA mode](/guide/sea-mode#enhanced-sea--full-project-with-package-json), ESM entry points with top-level await work on every supported target (Node >= 22) **without** the async-IIFE transform. ESM entries are dispatched via `vm.Script` + `USE_MAIN_CONTEXT_DEFAULT_LOADER`. If your project relies heavily on modern ESM, SEA mode is the cleaner path.
:::

## See also

- [SEA mode](/guide/sea-mode) — first-class ESM support
- [Recipes: ship an ESM project](/guide/recipes#ship-an-esm-project-with-top-level-await)
- [Troubleshooting: `ERR_REQUIRE_ESM`](/guide/troubleshooting#error-err-require-esm)
