## [5.15.0](https://github.com/yao-pkg/pkg/compare/v5.14.2...v5.15.0) (2024-09-20)

### Features

- bump @yao-pkg/pkg-fetch@3.5.13 with nodejs 22.9.0 ([#91](https://github.com/yao-pkg/pkg/issues/91)) ([6ed5665](https://github.com/yao-pkg/pkg/commit/6ed566564f87867812557ec453002c50a3dc6045))

## [5.14.2](https://github.com/yao-pkg/pkg/compare/v5.14.1...v5.14.2) (2024-09-17)

### Bug Fixes

- child_process commands throw when pkg app try to call itself ([#90](https://github.com/yao-pkg/pkg/issues/90)) ([e88d159](https://github.com/yao-pkg/pkg/commit/e88d15919fa16a8bba7991a165ebbf2336e13dce))

## [5.14.1](https://github.com/yao-pkg/pkg/compare/v5.14.0...v5.14.1) (2024-09-17)

### Bug Fixes

- bump pkg-fetch@3.5.12 with missing node22 macOS arm64 support ([4eea80c](https://github.com/yao-pkg/pkg/commit/4eea80c26d6eec8b7962392a7938048612f41673))

## [5.14.0](https://github.com/yao-pkg/pkg/compare/v5.13.0...v5.14.0) (2024-09-10)

### Features

- bump pkg-fetch@3.5.11 with nodejs 22 support (by [@faulpeltz](https://github.com/faulpeltz)) ([1d8df70](https://github.com/yao-pkg/pkg/commit/1d8df70e21f159d970077d178014add773361c87))

## [5.13.0](https://github.com/yao-pkg/pkg/compare/v5.12.1...v5.13.0) (2024-09-06)

### Features

- bump pkg-fetch@3.5.10 with node 20.17.0 and 18.20.4 support ([dda9032](https://github.com/yao-pkg/pkg/commit/dda90320fc05d9caf95124890915b1ff684685fb))

### Bug Fixes

- wrong placeholder replaced in windows binary ([#86](https://github.com/yao-pkg/pkg/issues/86)) ([d9b28c3](https://github.com/yao-pkg/pkg/commit/d9b28c391bc7d94df2b95074b98ee43681c67b5a))

## [5.12.1](https://github.com/yao-pkg/pkg/compare/v5.12.0...v5.12.1) (2024-08-14)

### Bug Fixes

- remove `is-core-module` dependency ([#77](https://github.com/yao-pkg/pkg/issues/77)) ([2f27414](https://github.com/yao-pkg/pkg/commit/2f27414d5dfa3e375118cac14932ab0d2ece92d7))
- run prebuild-install only if actually used by the package ([#83](https://github.com/yao-pkg/pkg/issues/83)) ([2a046e4](https://github.com/yao-pkg/pkg/commit/2a046e4be321e1c564744a161ec65b213baaa6ae))

### Chores

- drop package-lock file uploaded by error ([ba407ef](https://github.com/yao-pkg/pkg/commit/ba407efef1d2e611d4c192b93295dcaa023fea79))

## [5.12.0](https://github.com/yao-pkg/pkg/compare/v5.11.5...v5.12.0) (2024-06-10)

### Features

- add `ignore` option to ignore files from build ([#68](https://github.com/yao-pkg/pkg/issues/68)) ([54ae1ee](https://github.com/yao-pkg/pkg/commit/54ae1eea4a7f227d7a7246c5c3d43cf4b025c921))

### Bug Fixes

- use cache directory in users home instead of system-wide tmp dir ([#55](https://github.com/yao-pkg/pkg/issues/55)) ([a217727](https://github.com/yao-pkg/pkg/commit/a217727d71ba2490c0988077011595fe54d26711))

### Chores

- fix build ([276651a](https://github.com/yao-pkg/pkg/commit/276651aaa38451c4ba67ea2e46c9bdea6547ee2d))

## [5.11.5](https://github.com/yao-pkg/pkg/compare/v5.11.4...v5.11.5) (2024-03-13)

### Bug Fixes

- add dictionary for thread-stream (Used by pino) ([#36](https://github.com/yao-pkg/pkg/issues/36)) ([b01d1ad](https://github.com/yao-pkg/pkg/commit/b01d1ad44cc1dc6a1f91c2d371e63ea20e49cbc6))
- dictionary for sqlite3 ([#40](https://github.com/yao-pkg/pkg/issues/40)) ([a3b18f8](https://github.com/yao-pkg/pkg/commit/a3b18f86968670a8f9978e7270ef89c2e7dabed1))
- pass `--runtime napi` to `prebuild-install` when `binary.napi_versions` is set ([#38](https://github.com/yao-pkg/pkg/issues/38)) ([d47ee03](https://github.com/yao-pkg/pkg/commit/d47ee03f0ae58e53263e0fc8feae27748db4aab9))

### Chores

- add update dep workflow ([12d1872](https://github.com/yao-pkg/pkg/commit/12d18724461cc6d44fac792d164db26c033723bf))
- fix workflow permissions ([c279732](https://github.com/yao-pkg/pkg/commit/c2797325e2e49d0cab3bf3e20e9f6171f76fd3e6))

## [5.11.4](https://github.com/yao-pkg/pkg/compare/v5.11.3...v5.11.4) (2024-02-16)

### Features

- pkg-fetch@3.5.9 with nodejs 18.19.1 and 20.11.1 ([d6485df](https://github.com/yao-pkg/pkg/commit/d6485df9a0b065be450600785d3a5d52108fddb6))

### Bug Fixes

- tests ([#34](https://github.com/yao-pkg/pkg/issues/34)) ([7472af7](https://github.com/yao-pkg/pkg/commit/7472af714d1766f6a4f62cfdfe038d3291b5cd72))

## [5.11.3](https://github.com/yao-pkg/pkg/compare/v5.11.2...v5.11.3) (2024-02-12)

### Bug Fixes

- node18.19 broken binaries ([2e99185](https://github.com/yao-pkg/pkg/commit/2e99185317bbd6278fadeb9cca4741303c6fbfe0)), closes [#28](https://github.com/yao-pkg/pkg/issues/28)

## [5.11.2](https://github.com/yao-pkg/pkg/compare/v5.11.1...v5.11.2) (2024-02-06)

### Features

- pkg-fetch@3.5.8 with nodejs 18.19.0 and 20.11.0 support ([da8d530](https://github.com/yao-pkg/pkg/commit/da8d530b85891e18e95df5a93f87c33c2e8246a4))

## [5.11.1](https://github.com/yao-pkg/pkg/compare/v5.11.0...v5.11.1) (2024-01-03)

### Bug Fixes

- add missing arch to nativePrebuildInstall cache ([#9](https://github.com/yao-pkg/pkg/issues/9)) ([cd89e83](https://github.com/yao-pkg/pkg/commit/cd89e83586c301a2a31ff510023ee2667a1aae07))
- over extracting native modules with pnpm ([#14](https://github.com/yao-pkg/pkg/issues/14)) ([e435796](https://github.com/yao-pkg/pkg/commit/e43579620f3278fae1ac00b8db024912ca61a4c1))

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
