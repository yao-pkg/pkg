# Injecting Windows executable metadata after packaging

Executables created with `pkg` are based on a Node.js binary and, by default, inherit its embedded metadata — version number, product name, company name, icon, description. This can be misleading or unpolished in distributed applications.

There are two ways to customise the metadata of the resulting `.exe`:

1. **Use a custom Node.js binary** with your own metadata already embedded — see [Custom Node.js binary](/guide/custom-node).
2. **Post-process the generated executable** using [`resedit`](https://www.npmjs.com/package/resedit), a Node.js-compatible tool for modifying Windows executable resources. This allows injecting correct version info, icons, copyright, and more.

This page focuses on the second approach.

::: warning
Other tools may corrupt the executable, resulting in runtime errors such as `Pkg: Error reading from file.` — [`resedit`](https://www.npmjs.com/package/resedit) has proven to work reliably with `pkg`-generated binaries.
:::

## Node.js API

```ts
import * as ResEdit from 'resedit';
import * as fs from 'fs';
import * as path from 'path';

// Set your inputs:
const exePath = 'dist/my-tool.exe'; // Path to the generated executable
const outputPath = exePath; // Overwrite or use a different path
const version = '1.2.3'; // Your application version

const lang = 1033; // en-US
const codepage = 1200; // Unicode

const exeData = fs.readFileSync(exePath);
const exe = ResEdit.NtExecutable.from(exeData);
const res = ResEdit.NtExecutableResource.from(exe);

const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
const vi = viList[0];

const [major, minor, patch] = version.split('.');
vi.setFileVersion(Number(major), Number(minor), Number(patch), 0, lang);
vi.setProductVersion(Number(major), Number(minor), Number(patch), 0, lang);

vi.setStringValues(
  { lang, codepage },
  {
    FileDescription: 'ACME CLI Tool',
    ProductName: 'ACME Application',
    CompanyName: 'ACME Corporation',
    ProductVersion: version,
    FileVersion: version,
    OriginalFilename: path.basename(exePath),
    LegalCopyright: `© ${new Date().getFullYear()} ACME Corporation`,
  },
);

vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
const newBinary = exe.generate();

fs.writeFileSync(outputPath, Buffer.from(newBinary));
```

## Command line

[`resedit`](https://www.npmjs.com/package/resedit) also supports command-line usage. This is convenient for simple use cases in build scripts.

The following examples inject an icon and metadata into the executable `dist/bin/app_with_metadata.exe`, based on the built file `dist/bin/app.exe`.

**PowerShell (Windows):**

```powershell
npx resedit dist/bin/app.exe dist/bin/app_with_metadata.exe `
  --icon 1,dist/favicon.ico `
  --company-name "ACME Corporation" `
  --file-description "ACME CLI Tool" `
  --product-name "ACME Application" `
  --file-version 1.2.3.4
```

**bash (Linux/macOS):**

```bash
npx resedit dist/bin/app.exe dist/bin/app_with_metadata.exe \
  --icon 1,dist/favicon.ico \
  --company-name "ACME Corporation" \
  --file-description "ACME CLI Tool" \
  --product-name "ACME Application" \
  --file-version 1.2.3.4
```

::: tip
This is especially useful when cross-compiling Windows executables from Linux or macOS using `pkg`.
:::

See the [`resedit`](https://www.npmjs.com/package/resedit) package on npm for additional examples and full API documentation.
