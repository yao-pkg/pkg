# Troubleshooting

## Error: `Error [ERR_REQUIRE_ESM]: require() of ES Module`

This error is tracked by issue [#16](https://github.com/yao-pkg/pkg/issues/16#issuecomment-1945486658). Follow the link for a workaround.

In most cases adding `--options experimental-require-module` to the `pkg` command line solves the issue.

::: tip Node.js >= 22.12.0
This option is not needed starting from Node.js v22.12.0.
:::

## Error: Cannot find module XXX (when using `child_process`)

When using `child_process` methods to run a new process, `pkg` by default invokes it using the Node.js runtime built into the executable. If you're trying to spawn the packaged app itself, you'll get the above error. To avoid it, set `PKG_EXECPATH` to an empty string:

```js
const { spawn } = require('child_process');

const child = spawn(process.execPath, [process.argv[1]], {
  env: {
    ...process.env,
    PKG_EXECPATH: '',
  },
});
```

More info in [PR #90](https://github.com/yao-pkg/pkg/pull/90).

## Error: Cannot execute binary from snapshot

Binaries must be extracted from the snapshot in order to be executed. One approach:

```js
const cp = require('child_process');
const fs = require('fs');
const { pipeline } = require('stream/promises');

let ffmpeg = require('@ffmpeg-installer/ffmpeg').path;

const loadPlugin = async () => {
  if (process.pkg) {
    // copy ffmpeg to the current directory
    const file = fs.createWriteStream('ffmpeg');
    await pipeline(fs.createReadStream(ffmpeg), file);

    fs.chmodSync('ffmpeg', 0o755);
    console.log('ffmpeg copied to the current directory');
    ffmpeg = './ffmpeg';
  }

  cp.execSync(ffmpeg);
};

loadPlugin();
```

## Error: `ENOENT: no such file or directory, uv_chdir`

This can be caused by deleting the directory the application is run from — or, more generally, deleting `process.cwd()` while the application is running.

## Error: `ERR_INSPECTOR_NOT_AVAILABLE`

This error can be caused by using the `NODE_OPTIONS` variable to force `node` into debug mode. Debugging options are disallowed because **pkg** executables are usually used for production environments. If you need to use the inspector, you can [build a debuggable Node.js](https://github.com/yao-pkg/pkg/issues/93#issuecomment-301210543) yourself.

## Error: `require(...).internalModuleStat is not a function`

This error can be caused by using `NODE_OPTIONS` with some bootstrap or `node` options that conflict with **pkg**. Some IDEs, such as VS Code, may add this env variable automatically.

On Unix systems (Linux/macOS), check with:

```bash
printenv | grep NODE
```
