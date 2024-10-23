# PKG Development

This document aims to help you get started with `pkg` developemnt.

## Release Process

In order to create release just run the command:

```bash
npm run release
```

This command will start an interactive process that will guide you through the release process using [release-it](https://github.com/release-it/release-it)

## Testing

Before running tests ensure you have build the project by running:

```bash
npm run build
```

> [!NOTE]
> Remember to run again `npm run build` after changing the code.

Than you can use the following command to run tests:

```bash
node test/test.js <target> [no-npm | only-npm | all] [<flavor>]
```

- `<target>` is the node target the test will use when creating executables, can be `nodeXX` (like `node20`) or `host` (uses host node version as target).
- `[no-npm | only-npm | all]` to specify which tests to run. `no-npm` will run tests that don't require npm, `only-npm` will run against some specific npm modules, and `all` will run all tests.
- `<flavor>` to use when you want to run only tests matching a specific pattern. Example: `node test/test.js all test-99-*`. You can also set this by using `FLAVOR` environment variable.

Each test is located inside `test` directory into a dedicated folder named following the pattern `test-XX-*`. The `XX` is a number that represents the order the tests will run.

When running `node test/test.js all`, based on the options, each test will be run consecutively by running `main.js` file inside the test folder.

### Special tests

- `test-79-npm`: It's the only test runned when using `only-npm`. It install and tests all node modules listed inside that dir and verifies if they are working correctly.
- `test-42-fetch-all`: Foreach known node version verifies there is a patch existing for it using pkg-fetch.
- `test-46-multi-arch`: Tries to cross-compile a binary for all known architectures.
