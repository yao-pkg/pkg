# Snapshot filesystem

During the packaging process `pkg` collects project files and places them into the executable. This bundle is called a **snapshot**. At run time the packaged application has access to a snapshot filesystem where all those files reside.

Packaged files have a `/snapshot/` prefix in their paths (or `C:\snapshot\` on Windows). If you used `pkg /path/app.js`, then at runtime `__filename` is likely `/snapshot/path/app.js`, and `__dirname` is `/snapshot/path`.

Here is the comparison table of path-related values:

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

To use a file collected at packaging time (`require` a JavaScript file or serve an asset) you should take `__filename`, `__dirname`, `process.pkg.defaultEntrypoint`, or `require.main.filename` as a base for your path calculations.

For JavaScript files you can just `require` or `require.resolve` because they use the current `__dirname` by default. For assets, use `path.join(__dirname, '../path/to/asset')`. Learn more about `path.join` in [Detecting assets in source code](/guide/detecting-assets).

On the other hand, to access the **real** filesystem at run time — pick up a user's external JavaScript plugin, JSON configuration, or list a user's directory — use `process.cwd()` or `path.dirname(process.execPath)`.
