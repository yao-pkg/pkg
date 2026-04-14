# Configuration

During the packaging process `pkg` parses your sources, detects calls to `require`, traverses the dependencies of your project, and includes them in the executable. In most cases you don't need to specify anything manually.

However, your code may have `require(variable)` calls (a so-called non-literal argument to `require`) or use non-JavaScript files (views, CSS, images, etc.):

```js
require('./build/' + cmd + '.js');
path.join(__dirname, 'views/' + viewName);
```

These cases are not handled automatically. You must specify scripts and assets manually in the `pkg` property of your `package.json`.

```json
{
  "pkg": {
    "scripts": "build/**/*.js",
    "assets": "views/**/*",
    "targets": ["node22-linux-arm64"],
    "outputPath": "dist"
  }
}
```

The example above includes everything in `assets/` and every `.js` file in `build/`, builds only for `node22-linux-arm64`, and places the executable inside `dist/`.

You may also specify arrays of globs:

```json
{
  "pkg": {
    "assets": ["assets/**/*", "images/**/*"]
  }
}
```

Call `pkg package.json` or `pkg .` to make use of the `package.json` configuration.

## Scripts

`scripts` is a [glob](https://github.com/SuperchupuDev/tinyglobby) or a list of globs. Files specified as `scripts` are compiled with `v8::ScriptCompiler` and placed into the executable **without sources**. They must conform to the JS standard of the Node.js versions you target (see [Targets](/guide/targets)) — i.e. be already transpiled.

## Assets

`assets` is a [glob](https://github.com/SuperchupuDev/tinyglobby) or a list of globs. Files specified as `assets` are packaged into the executable as raw content without modification. JavaScript files may also be specified as assets. Their sources are not stripped, which improves execution performance and simplifies debugging.

See also [Detecting assets in source code](/guide/detecting-assets) and [Snapshot filesystem](/guide/snapshot-fs).

## Ignore files

`ignore` is a list of globs. Files matching these paths are excluded from the final executable. Useful when you want to exclude tests, documentation, or build files that a dependency brings along:

```json
{
  "pkg": {
    "ignore": ["**/*/dependency-name/build.c"]
  }
}
```

Note that `**` and `*` do **not** match dotfiles like `.git`. Dotfile names must be spelled explicitly in the glob.

To see which unwanted files ended up in your executable, read the [Exploring virtual file system in debug mode](/guide/advanced-debug-vfs) section.
