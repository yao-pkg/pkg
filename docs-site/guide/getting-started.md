# Getting started

## Install

```sh
npm install -g @yao-pkg/pkg
```

Requires **Node.js >= 22** on the build host.

## Build your first binary

The entrypoint of your project is a mandatory CLI argument. It may be:

- **Path to an entry file.** `pkg /path/app.js` packages as if you ran `node /path/app.js`.
- **Path to `package.json`.** `pkg` follows the `bin` property and uses it as the entry file.
- **Path to a directory.** `pkg` looks for `package.json` in that directory (same as above).

```sh
# Single file — builds for linux, macos, win by default
pkg index.js

# Follow the "bin" entry of the current package.json
pkg .
```

## CLI reference

```console
pkg [options] <input>

Options:

  -h, --help           output usage information
  -v, --version        output pkg version
  -t, --targets        comma-separated list of targets (see examples)
  -c, --config         package.json or any json file with top-level config
  --options            bake v8 options into executable to run with them on
  -o, --output         output file name or template for several files
  --out-path           path to save output one or more executables
  -d, --debug          show more information during packaging process [off]
  -b, --build          don't download prebuilt base binaries, build them
  --public             speed up and disclose the sources of top-level project
  --public-packages    force specified packages to be considered public
  --no-bytecode        skip bytecode generation and include source files as plain js
  --no-native-build    skip native addons build
  --no-dict            comma-separated list of packages names to ignore dictionaries. Use --no-dict * to disable all dictionaries
  -C, --compress       [default=None] compression algorithm = Brotli or GZip
  --sea                (Experimental) compile using node's SEA feature. With package.json input and node >= 22, uses enhanced mode with full dependency walking and VFS
```

## Examples

```sh
# Makes executables for Linux, macOS and Windows
pkg index.js

# Takes package.json from cwd and follows 'bin' entry
pkg .

# Makes executable for a particular target machine
pkg -t node22-win-arm64 index.js

# Makes executables for target machines of your choice
pkg -t node22-linux,node24-linux,node24-win index.js

# Bakes '--expose-gc' and '--max-heap-size=34' into executable
pkg --options "expose-gc,max-heap-size=34" index.js

# Consider packageA and packageB to be public
pkg --public-packages "packageA,packageB" index.js

# Consider all packages to be public
pkg --public-packages "*" index.js

# Reduce size of the data packed inside the executable with GZip
pkg --compress GZip index.js

# Compile using node's SEA feature
pkg --sea index.js
```

Run `pkg --help` at any time for the live list of options.
