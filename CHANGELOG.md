## [5.11.0](https://github.com/yao-pkg/pkg/compare/v5.10.0...v5.11.0) (2023-12-05)

### Features

- bump pkg-fetch@3.5.7 with node20 support ([efb585a](https://github.com/yao-pkg/pkg/commit/efb585a6cdd4cc2595e897ca9561997e3552a40e))

### Bug Fixes

- parsing of .cjs files as .js ([#8](https://github.com/yao-pkg/pkg/issues/8)) ([ecd064c](https://github.com/yao-pkg/pkg/commit/ecd064c9ddb15e69c44f09c7a8928d54c95c22f6))

### Chores

- update vscode settings ([bf490a0](https://github.com/yao-pkg/pkg/commit/bf490a08907d0d075548d0feb06135a750c2a365))

## [5.10.0](https://github.com/yao-pkg/pkg/compare/v5.9.2...v5.10.0) (2023-10-28)

### Features

- bump fetch 3.5.6 with MacOS arm64 support ([#7](https://github.com/yao-pkg/pkg/issues/7)) ([efee79c](https://github.com/yao-pkg/pkg/commit/efee79c6a67418dcdc4874b8851acd1d5d956391))

## [5.9.2](https://github.com/yao-pkg/pkg/compare/v5.9.1...v5.9.2) (2023-10-17)

### Features

- bump pkg-fetch@3.5.5 ([#6](https://github.com/yao-pkg/pkg/issues/6)) ([99d3562](https://github.com/yao-pkg/pkg/commit/99d35621f006f06bc595672752b5b5a521b979a0))

### Documentation

- update env vars ([406c451](https://github.com/yao-pkg/pkg/commit/406c451c325df42334870c3e70db46d8db333d0d))

## [5.9.1](https://github.com/yao-pkg/pkg/compare/v5.9.0...v5.9.1) (2023-10-05)

### Bug Fixes

- tests using wrong `pkg-fetch` package ([8466f1d](https://github.com/yao-pkg/pkg/commit/8466f1d32eac15206c88f6c58d80e8179c0a68d5))

### Chores

- bump fetch to fix sha mismatch ([#4](https://github.com/yao-pkg/pkg/issues/4)) ([9d454e0](https://github.com/yao-pkg/pkg/commit/9d454e0078830b6b5e9fa3c118ba5f79f9d52e77))

## [5.9.0](https://github.com/yao-pkg/pkg/compare/v5.8.1...v5.9.0) (2023-10-04)

### Features

- add option to skip signature on macos ([#1878](https://github.com/yao-pkg/pkg/issues/1878)) ([edfdadb](https://github.com/yao-pkg/pkg/commit/edfdadbca6ddd9526dedcc81bd876d408aae825f))
- support node19 ([#1862](https://github.com/yao-pkg/pkg/issues/1862)) ([e388983](https://github.com/yao-pkg/pkg/commit/e38898355817df7af322c05a74b7d536a660bc12))

### Bug Fixes

- Add missing functions from restored fs.Stats ([#1923](https://github.com/yao-pkg/pkg/issues/1923)) ([e51efbe](https://github.com/yao-pkg/pkg/commit/e51efbe14ffd6d649420419cbd835146d1a7a612))
- diagnostic folder size and humanize size ([4f5b63c](https://github.com/yao-pkg/pkg/commit/4f5b63ca9ce9712da21348175cce54ae0322e254))
- missing entrypoint when launched from self-created child process ([#1949](https://github.com/yao-pkg/pkg/issues/1949)) ([73a03d1](https://github.com/yao-pkg/pkg/commit/73a03d1c27d879ff82a6d7b58c5f08c1da8a6a6b))
- organization name ([165e9a1](https://github.com/yao-pkg/pkg/commit/165e9a1c3e1c3cf9f26e61b8975c28cc4b919b38))

### Test added

- ignore pnpm test for node14 ([#1919](https://github.com/yao-pkg/pkg/issues/1919)) ([7255f64](https://github.com/yao-pkg/pkg/commit/7255f6470484774459e84375411e0d95b1711f4e))
- update tesseract.js test for v4 ([#1864](https://github.com/yao-pkg/pkg/issues/1864)) ([265c00e](https://github.com/yao-pkg/pkg/commit/265c00e435d139c3d6d0cc50de60209ca7b1c9f9))

### Chores

- add release script ([#2](https://github.com/yao-pkg/pkg/issues/2)) ([6dd5e11](https://github.com/yao-pkg/pkg/commit/6dd5e11a954f7e51a6cc8181b3389fa5143b448e))
- bump @yao-pkg/pkg-fetch@3.5.3 ([f43dd71](https://github.com/yao-pkg/pkg/commit/f43dd711b1791f4ef40d7734bfcf1c7a88d6ab04))
- bump deps and lint fix ([#1](https://github.com/yao-pkg/pkg/issues/1)) ([448c81a](https://github.com/yao-pkg/pkg/commit/448c81a4a2200d4cd2253046a19573e33a20b790))
- bump pkg-fetch to 3.5.2 ([#1914](https://github.com/yao-pkg/pkg/issues/1914)) ([76010f6](https://github.com/yao-pkg/pkg/commit/76010f66a4b178d0d517c9f30bd14f6bd0a4474f))
- **ci:** drop nodejs 14 ([d234904](https://github.com/yao-pkg/pkg/commit/d2349045a7324088d6efd9ee778335cb467ae5b7))
- fix npm pkg errors ([60950fa](https://github.com/yao-pkg/pkg/commit/60950facb3d6ebaa57e9ceb974f4c560b2a40958))
- fix package.json name ([3d011c1](https://github.com/yao-pkg/pkg/commit/3d011c1f037e8d5372906f08f8edb12163e0d6d5))
- make corruption test pass on macos ([#1890](https://github.com/yao-pkg/pkg/issues/1890)) ([8eef5ea](https://github.com/yao-pkg/pkg/commit/8eef5eace55a55c4095a719926156ec2d5166a53))
- remove eol nodejs in tests ([#1889](https://github.com/yao-pkg/pkg/issues/1889)) ([4fe0b4d](https://github.com/yao-pkg/pkg/commit/4fe0b4d3308624ebeed3283891ff9e4328c55a1c))
- remove node20 from ci ([15fe2dc](https://github.com/yao-pkg/pkg/commit/15fe2dcd2fa5e9eba51c44d62fcb6e0c6c482b39))
- remove unused dependencies ([#1769](https://github.com/yao-pkg/pkg/issues/1769)) ([c353cc9](https://github.com/yao-pkg/pkg/commit/c353cc9ce8afba97bb6f5c92f71384498835071b))

### Documentation

- fix install command ([3e63d90](https://github.com/yao-pkg/pkg/commit/3e63d90e453ee51134aec956524d3389506f8959))
