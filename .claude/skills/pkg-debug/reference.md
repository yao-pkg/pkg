# pkg Configuration & Patches Reference

Supporting reference for the `/pkg-debug` skill.

## Full pkg configuration schema

```json
{
  "pkg": {
    "scripts": ["build/**/*.js"],
    "assets": ["views/**/*", "public/**/*"],
    "ignore": ["**/*/node_modules/*/test/**"],
    "targets": ["node22-linux-x64", "node22-macos-arm64", "node22-win-x64"],
    "outputPath": "dist",
    "patches": { "node_modules/foo/bar.js": ["old", "new"] },
    "sea": true,
    "seaConfig": {
      "useCodeCache": false,
      "disableExperimentalSEAWarning": true
    },
    "deployAssets": false
  }
}
```

| Key            | Type             | Purpose                                         |
| -------------- | ---------------- | ----------------------------------------------- |
| `scripts`      | glob \| string[] | JS compiled to V8 bytecode, source stripped     |
| `assets`       | glob \| string[] | Raw files embedded in VFS under `/snapshot/`    |
| `ignore`       | string[]         | Globs excluded from the binary                  |
| `targets`      | string[]         | Target triples (`node<ver>-<os>-<arch>`)        |
| `outputPath`   | string           | Output directory (equiv. to CLI `--out-path`)   |
| `patches`      | object           | String replacements applied at walk time        |
| `sea`          | boolean          | Opt into SEA mode without CLI `--sea`           |
| `seaConfig`    | object           | Forwarded to Node.js SEA config                 |
| `deployAssets` | boolean          | Copy assets next to binary instead of embedding |

See: <https://yao-pkg.github.io/pkg/guide/configuration>

---

## Patches in package.json

### Format

```json
{
  "pkg": {
    "patches": {
      "file-path": ["search1", "replace1", "search2", "replace2"]
    }
  }
}
```

The walker applies these string replacements when adding the file to the
archive. The original file on disk is not modified.

### Real-world examples

```json
{
  "pkg": {
    "patches": {
      "node_modules/@sentry/node/cjs/anr/index.js": [
        "const inspector = require('inspector');",
        "const inspector = { open: () => {}, url: () => 'fake-pkg-url' };"
      ],
      "node_modules/rtsp-relay/index.js": [
        "(require('ffmpeg-static'))",
        "'/usr/bin/ffmpeg'"
      ],
      "node_modules/thread-stream/lib/worker.js": [
        "worker = (await realImport(filename))",
        "worker = realRequire(decodeURIComponent(filename.replace(process.platform === 'win32' ? 'file:///' : 'file://', '')))"
      ],
      "node_modules/pino/lib/transport-stream.js": [
        "fn = (await realImport(toLoad))",
        "fn = realRequire(target)"
      ],
      "node_modules/fontkit/dist/main.cjs": [
        "new TextDecoder('ascii');",
        "new TextDecoder('utf-8');"
      ]
    }
  }
}
```

### Monorepo / npm workspaces

Paths are relative to the package.json that contains the `pkg` config. In a
workspace layout where `node_modules` is hoisted to the root, use relative
paths accordingly:

```json
{
  "pkg": {
    "patches": {
      "../../node_modules/@sentry/node/cjs/anr/index.js": [
        "const inspector = require('inspector');",
        "const inspector = { open: () => {}, url: () => 'fake-pkg-url' };"
      ]
    },
    "scripts": ["dist/**/*.js", "../../node_modules/pino/lib/worker.js"],
    "assets": [
      "../../node_modules/@img/**",
      "../../node_modules/pdfkit/js/data/**"
    ]
  }
}
```

---

## Built-in dictionaries

`pkg` ships with a `dictionary/` folder containing pre-configured patches for
known npm packages. These are applied automatically — no user config needed.

### Dictionary file format

```javascript
'use strict';

module.exports = {
  pkg: {
    scripts: ['lib/types/*.js'], // compiled to bytecode
    patches: {
      // string replacements
      'lib/index.js': [
        'path.join(__dirname, "..")',
        'path.dirname(process.execPath)',
      ],
    },
    deployFiles: [
      // extracted next to binary
      ['prebuilds', 'zeromq/prebuilds', 'directory'],
    ],
  },
};
```

### Check existing dictionaries

```bash
ls dictionary/ | grep <package-name>
```

If a package needs special handling but has no dictionary:

1. Add patches to your `package.json` `pkg.patches` (project-local fix)
2. Contribute a dictionary file to `yao-pkg/pkg` (helps all users)

---

## Contributing fixes back to pkg

When debugging reveals a bug in pkg itself (not in the user's project):

1. **Reproduce** — create a minimal test case that triggers the issue
2. **Locate the root cause** in `lib/` (TypeScript source, compiled via `yarn build`)
3. **Fix and test** — run the relevant tests:
   ```bash
   FLAVOR=test-XX-name node test/test.js node22 no-npm
   ```
4. **Lint** — `yarn fix` before committing
5. **Open a PR** against `yao-pkg/pkg` (never `vercel/pkg` — it is archived)
6. Use conventional commits: `fix:`, `feat:`, `refactor:`, etc.

If the fix involves a missing dictionary entry for an npm package, add a file
to `dictionary/<package-name>.js` following the format above (see
`dictionary/zeromq.js` for a complete real-world example).
