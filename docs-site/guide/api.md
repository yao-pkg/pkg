# API

```js
const { exec } = require('pkg');
```

`exec(args)` takes an array of command-line arguments and returns a promise. For example:

```js
await exec(['app.js', '--target', 'host', '--output', 'app.exe']);
// do something with app.exe, run, test, upload, deploy, etc.
```
