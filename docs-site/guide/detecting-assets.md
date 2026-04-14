# Detecting assets in source code

When `pkg` encounters `path.join(__dirname, '../path/to/asset')`, it automatically packages the referenced file as an asset. See [Assets](/guide/configuration#assets).

Pay attention: `path.join` must have exactly two arguments, and the last one must be a string literal.

This way you may even avoid creating a `pkg` config for your project.
