# GitHub Copilot Instructions for pkg

This is a TypeScript-based Node.js project that packages Node.js applications into standalone executables. The project is maintained by the yao-pkg organization and is a fork of the original vercel/pkg project.

## CRITICAL: Repository and PR Guidelines

**IMPORTANT:** This repository is `yao-pkg/pkg`, a fork of the original `vercel/pkg` (which is ARCHIVED and read-only).

- ✅ **ALWAYS create PRs against `yao-pkg/pkg`** (this fork)
- ❌ **NEVER create PRs against `vercel/pkg`** (the upstream is archived and cannot accept PRs)
- When using `gh pr create`, always specify the correct repository
- The upstream `vercel/pkg` should be completely ignored for PR creation purposes

## Project Overview

`pkg` is a command-line tool that:

- Packages Node.js projects into executables for multiple platforms (Linux, macOS, Windows)
- Supports multiple Node.js versions (node18, node20, etc.)
- Uses virtual filesystem to bundle application files
- Compiles JavaScript to V8 bytecode for distribution
- Supports native addons (.node files)
- Provides compression options (Brotli, GZip)

## Repository Structure

- `lib/`: TypeScript source code for the main packaging logic
- `lib-es5/`: Compiled JavaScript output (generated, do not edit directly)
- `prelude/`: Bootstrap code injected into packaged executables
- `dictionary/`: Package-specific configuration files for known npm packages
- `test/`: Comprehensive test suite with numbered test directories
- `examples/`: Example projects demonstrating pkg usage
- `plans/`: Implementation plans and design documents
- `.github/workflows/`: CI/CD configuration using GitHub Actions

## Development Workflow

### Building

Before running tests or making changes, always build the project:

```bash
npm run build
```

This compiles TypeScript from `lib/` to `lib-es5/` using the TypeScript compiler.

For continuous development with auto-rebuild:

```bash
npm run start
```

### Code Standards

#### Required Before Each Commit

- Run `npm run lint` to check both code style and ESLint rules
- Run `npm run fix` to automatically fix formatting and linting issues
- All changes must pass CI checks (linting, building, and tests)

#### Commit and Push Workflow

**CRITICAL: Follow this workflow for ALL commits and pushes:**

1. **Clean test artifacts**: Remove any test-generated output files (executables, binaries) before staging changes
   - Test artifacts typically include: `*.exe`, `*-linux`, `*-macos`, `*-win.exe` in test directories
   - Check staged files with `git status` and remove any test outputs
   - These files may remain if a test failed before cleanup

2. **Verify no lint issues**:
   - ALWAYS run `npm run lint` before committing
   - Fix all linting errors with `npm run fix` or manually
   - NEVER commit or push with lint errors present

3. **Request approval before commit/push**:
   - Show the user what files will be committed (`git status --short`)
   - Present a summary of changes made
   - Wait for explicit user approval before running `git commit` and `git push`
   - Do NOT commit or push without user confirmation

4. **Commit with conventional commits format**:
   - Use: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`
   - Include detailed commit message explaining changes

This workflow ensures code quality, prevents accidental commits of test artifacts, and gives the user control over what gets committed to the repository.

#### Formatting

- Uses Prettier for code formatting
- Single quotes for strings (configured in package.json)
- Run `npm run lint:style` to check formatting
- Format files with: `prettier -w "{lib,prelude,test}/**/*.{ts,js}"`

#### Linting

- Uses ESLint with TypeScript support
- Configuration: `eslint-config-airbnb-typescript` and `eslint-config-prettier`
- Run `npm run lint:code` to check for linting issues
- Console statements are disallowed in production code (lint error), but allowed in test files and scripts

### Testing

The test suite is extensive and organized in numbered directories:

```bash
# Build first (required)
npm run build

# Run all tests
npm test

# Run tests for specific Node.js version
npm run test:18  # Test with Node.js 18
npm run test:20  # Test with Node.js 20
npm run test:host  # Test with host Node.js version

# Run specific test pattern
node test/test.js node20 no-npm test-50-*
```

#### Test Organization

- Tests are in `test/test-XX-*/` directories where XX indicates execution order
- Each test directory contains a `main.js` file that runs the test
- Tests use `utils.js` for common testing utilities
- Special tests:
  - `test-79-npm/`: Tests integration with popular npm packages (only-npm)
  - `test-42-fetch-all/`: Verifies patches exist for all Node.js versions
  - `test-46-multi-arch/`: Tests cross-compilation for multiple architectures

#### Writing Tests

When adding new tests:

1. Create a directory named `test-XX-descriptive-name/`
2. Create a `main.js` file that uses the test utilities
3. Use `utils.pkg.sync()` to invoke pkg within the test
4. Verify output files are created correctly
5. Clean up using `utils.filesAfter()`

Example test structure:

```javascript
#!/usr/bin/env node
'use strict';
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

// Test implementation here
```

### TypeScript Guidelines

1. **Strict mode**: The project uses TypeScript strict mode
2. **Target**: ES2017 (check tsconfig.json)
3. **Module system**: CommonJS (not ES modules)
4. **Type definitions**: Include type definitions for all public APIs
5. **Source files**: All TypeScript files should be in `lib/` directory
6. **No direct editing**: Never edit files in `lib-es5/` directly

### Key Files and Conventions

- `lib/index.js`: Main entry point for the pkg API
- `lib/bin.js`: CLI entry point
- `prelude/bootstrap.js`: Code injected into every packaged executable
- `dictionary/*.js`: Special handling for specific npm packages

### Dependencies

- **Runtime dependencies**: Keep minimal, as they affect all packaged apps
- **Native modules**: Be aware of `.node` file handling and extraction
- **pkg-fetch dependency**: Used to download pre-compiled Node.js binaries
- Always use exact or caret ranges for dependencies

## Release Process

The project uses `release-it` with conventional commits:

```bash
npm run release
```

This interactive process:

1. Runs linting checks
2. Generates changelog using conventional commits
3. Creates a git tag with format `v${version}`
4. Pushes to GitHub and creates a release
5. Publishes to npm under `@yao-pkg/pkg`

### Commit Message Format

Follow conventional commits format:

- `feat: description` - New features
- `fix: description` - Bug fixes
- `refactor: description` - Code refactoring
- `test: description` - Test additions
- `chore: description` - Maintenance tasks
- `docs: description` - Documentation changes

## Common Issues and Gotchas

### Virtual Filesystem

- Packaged apps have files at `/snapshot/` prefix (or `C:\snapshot\` on Windows)
- Use `__dirname` or `__filename` for files packaged in the snapshot
- Use `process.cwd()` for runtime filesystem access
- Path handling differs between packaged and non-packaged execution

### Native Addons

- Native addons are extracted to `$HOME/.cache/pkg/` at runtime
- Must match the Node.js version specified in `--target`
- `linuxstatic` target cannot load native bindings
- Add `.node` files to `assets` if not detected automatically

### Cross-Compilation

- Bytecode generation requires running target architecture binary
- Use `--no-bytecode` to disable bytecode compilation for cross-arch builds
- Consider using QEMU for emulation on Linux
- macOS arm64 can build x64 using Rosetta 2

### ESM Support

- ESM modules require `--options experimental-require-module` (Node.js < 22.12.0)
- Some packages may need special handling in dictionary files
- Check existing dictionary files for examples

## Best Practices for Contributing

1. **Read existing code**: Look at similar functionality before implementing new features
2. **Add tests**: Every new feature or bug fix should include a test
3. **Update documentation**: Update README.md and DEVELOPMENT.md as needed
4. **Check CI**: Ensure all CI checks pass before requesting review
5. **Small PRs**: Keep pull requests focused and reasonably sized
6. **Follow patterns**: Match existing code style and patterns
7. **Test cross-platform**: Test on Linux, macOS, and Windows when possible

## Platform-Specific Considerations

### Linux

- Supports both dynamic and static linking
- `linuxstatic` target for maximum portability
- Configure binfmt with QEMU for cross-arch testing

### macOS

- `arm64` support is experimental
- Code signing required for arm64 binaries
- Use `codesign` or `ldid` for signing

### Windows

- `.exe` extension required
- Native modules must match target architecture
- Consider post-processing with `resedit` for custom metadata

## CI/CD

The project uses GitHub Actions workflows:

- **ci.yml**: Runs linting and builds on multiple Node.js versions and OS platforms
- **test.yml**: Reusable workflow for running tests
- Matrix strategy tests: Node.js 18.x, 20.x on ubuntu-latest, windows-latest, macos-latest
- Linting only runs on ubuntu-latest with Node.js 18.x

## Support and Resources

- **Issues**: Report bugs and feature requests on GitHub
- **Discussions**: Use GitHub Discussions for questions
- **Documentation**: See README.md for user documentation
- **Development Guide**: See DEVELOPMENT.md for development details
- **Related Projects**:
  - [pkg-fetch](https://github.com/yao-pkg/pkg-fetch) - Pre-compiled Node.js binaries
  - [pkg-binaries](https://github.com/yao-pkg/pkg-binaries) - Binaries for unsupported architectures

## Important Notes for Copilot Coding Agent

1. **NEVER commit without user approval**: Always show changes with `git status --short`, present a summary, and wait for explicit user confirmation before running `git commit` or `git push`
2. **ALWAYS check lint before committing**: Run `npm run lint` before every commit and fix all issues - NEVER commit with lint errors
3. **Clean test artifacts before staging**: Remove any test-generated executables (`*.exe`, `*-linux`, `*-macos`, `*-win.exe`) from test directories before committing
4. **Always build before testing**: Run `npm run build` before running any tests
5. **Use correct Node.js version**: The project requires Node.js >= 18.0.0
6. **Use Yarn for package management**: This project uses `yarn`, not `npm`, for dependency management
7. **Respect TypeScript compilation**: Edit `lib/*.ts` files, not `lib-es5/*.js` files
8. **Maintain test numbering**: When adding tests, choose appropriate test number (XX in test-XX-name)
9. **Check existing dictionary files**: Before adding new package support, review existing dictionary files for patterns
10. **Preserve backward compatibility**: This tool is widely used; breaking changes need careful consideration
11. **Cross-platform testing**: When possible, verify changes work on Linux, macOS, and Windows
12. **Native addon handling**: Be extra careful with changes affecting native addon loading and extraction
13. **Snapshot filesystem**: Changes to virtual filesystem handling require thorough testing
14. **Performance matters**: Packaging time and executable size are important metrics
15. **Implementation plans**: Store all implementation plans and design documents in the `plans/` directory

## Git Workflow

- **Default branch**: `main`
- **Branch protection**: Requires passing CI checks
- **Tag format**: `v${version}` (e.g., v6.10.0)
- **Commit style**: Conventional commits for changelog generation
