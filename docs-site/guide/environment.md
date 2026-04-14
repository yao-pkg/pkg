# Environment variables

`pkg` honours all [`pkg-cache` environment vars](https://github.com/yao-pkg/pkg-fetch#environment), plus:

| Var                     | Description                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHDIR`                 | Override process `chdir`                                                                                                                                    |
| `PKG_NATIVE_CACHE_PATH` | Override the base directory for caching extracted native addons at runtime (default: `~/.cache`)                                                            |
| `PKG_STRICT_VER`        | Turn on some assertions in the walker code to assert that each file content/state appended to the virtual file system applies to a real file, not a symlink |
| `PKG_EXECPATH`          | Used internally by `pkg`, do not override                                                                                                                   |

## Examples

```bash
# 1. Set cache path at build time (for pkg-fetch to cache Node.js binaries)
export PKG_CACHE_PATH=/my/cache
pkg app.js

# 2. Set cache path at runtime (for the packaged app to cache extracted native addons)
PKG_NATIVE_CACHE_PATH=/opt/myapp/cache ./myapp

# 3. Both can be used together
PKG_CACHE_PATH=/build/cache PKG_NATIVE_CACHE_PATH=/runtime/cache pkg app.js
```
