# Custom Node.js binary

If you want to use a custom `node` binary, set the `PKG_NODE_PATH` environment variable to the path of the binary you want to use. `pkg` will use it instead of the default:

```bash
PKG_NODE_PATH=/path/to/node pkg app.js
```
