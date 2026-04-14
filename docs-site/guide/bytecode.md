# Bytecode

By default, your source code is precompiled to V8 bytecode before being written to the output file. To disable this feature, pass `--no-bytecode` to `pkg`.

## Why would you want to disable bytecode?

If you need a reproducible build process where your executable hashes (md5, sha1, sha256, …) are the same between builds. Compiling bytecode is not deterministic (see [here](https://ui.adsabs.harvard.edu/abs/2019arXiv191003478C/abstract) or [here](https://medium.com/dailyjs/understanding-v8s-bytecode-317d46c94775)), so different runs produce different hashes. Disabling bytecode compilation means a given input always produces the same output.

## Why would you **not** want to disable bytecode?

Compiling to bytecode doesn't make your source code 100% secure, but it adds a layer of security, privacy, and obscurity. With `--no-bytecode`, the raw source code is written directly to the executable. On a \*nix machine, run `pkg` with `--no-bytecode` and use GNU `strings` on the output — you'll be able to grep your source code.

## Other considerations

Specifying `--no-bytecode` fails if there are any packages in your project that aren't explicitly marked as public by `license` in their `package.json`. By default, `pkg` checks the license of each package and makes sure that non-public code is only included as bytecode.

If you need to build `pkg` binaries for other architectures, or if you depend on a package with a broken `license` in its `package.json`, override this behaviour by explicitly whitelisting packages via `--public-packages "packageA,packageB"` or setting all packages to public with `--public-packages "*"`.
