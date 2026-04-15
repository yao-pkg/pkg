---
name: pkg-xcompile-test
description: >
  Cross-compile test harness for @yao-pkg/pkg. Builds a tiny hello.js for
  every (mode × target) combination and runs what can be executed on a Linux
  host (native x64, arm64 via docker+qemu, win-x64 via docker-wine). Use
  when the user wants to verify pkg cross-compilation claims, reproduce
  issues #87/#181, sanity-check a pkg PR, or compare Standard vs Enhanced
  SEA across Node 20/22/24. Trigger: "test cross-compile", "run pkg
  matrix", "verify xcompile", or /pkg-xcompile-test.
---

# pkg cross-compile test harness

Validates `pkg` cross-OS and cross-arch support across Node 20/22/24 and
Standard vs Enhanced SEA modes. Produces a consistent result table so
claims in docs and issues can be checked against reality.

## When to use

- User is about to edit docs about cross-compile support and needs ground truth.
- User is looking at a cross-compile issue (e.g. [#87](https://github.com/yao-pkg/pkg/issues/87), [#181](https://github.com/yao-pkg/pkg/issues/181)) and wants to reproduce it.
- User bumped `pkg-fetch` or touched bootstrap/prelude and wants a smoke test across targets.
- User wants to know whether a regression is Node-version specific.

## Host requirements

This harness is designed for a **Linux x86_64** host with:

- `nvm` with node 20, 22, and 24 installed (`nvm install 20 22 24`).
- `docker` daemon running.
- `docker` image `scottyhardy/docker-wine` (pulled on first win-x64 run).
- `tonistiigi/binfmt` installed for cross-arch containers — if you see
  `exec format error` on arm64 runs, install with:
  ```bash
  docker run --privileged --rm tonistiigi/binfmt --install arm64
  ```
- `pkg` built from this repo (`yarn build`) so `lib-es5/bin.js` exists.
  The script resolves the pkg entry from its own location — it lives at
  `.claude/skills/pkg-xcompile-test/run-matrix.sh` and defaults
  `PKG_BIN` to `<repo-root>/lib-es5/bin.js`.

**Not supported:** macOS runtime verification. `docker-osx` needs `/dev/kvm`
and darling is dead. macOS regressions have to be caught on a real Mac
or on the GitHub Actions `macos-*` runners — note that in the final report.

## What it runs

For each Node major (20, 22, 24) the harness:

1. Uses `nvm use $major` so the pkg **host** node matches the **target**
   node major. This matters — SEA's blob generator uses host `execPath`
   when host-major == target-major, otherwise tries to run the downloaded
   target-arch node binary (which fails without cross-arch emulation).
2. Loops over modes × targets:
   - **Modes**: `std`, `std-public` (`--public-packages "*" --public`), `sea`
   - **Targets**: `linux-x64`, `linux-arm64`, `win-x64`, `macos-x64`, `macos-arm64`
3. Records **build result** (OK / FAIL), then tries to **run** the binary:
   - linux-x64 → native
   - linux-arm64 → `docker run --platform linux/arm64 ubuntu:latest`
   - win-x64 → `docker run scottyhardy/docker-wine` (see gotcha below)
   - macos-\* → skipped (`SKIP-no-mac`)
4. Prints a summary table.

## Wine gotcha

`wine` inside a non-tty docker container produces invalid stdio file
descriptors, causing Node to crash with `Error: open EBADF` before any
user code runs. The workaround is to redirect wine's stdout/stderr to
files **inside** the container, then `cat` them back:

```bash
docker run --rm -v "$BINDIR:/mnt" scottyhardy/docker-wine \
  bash -c "wine '/mnt/app.exe' </dev/null >/tmp/out 2>/tmp/err; cat /tmp/out"
```

Without this, every wine run will look like a pkg failure when it isn't.

## Usage

Run from the repo root (paths in the examples are relative to it).

### Quick run (single node version)

```bash
# Runs the full matrix for node 22 targets with node 22 as host
./.claude/skills/pkg-xcompile-test/run-matrix.sh 22
```

### Full sweep (20 + 22 + 24)

```bash
for V in 20 22 24; do
  ./.claude/skills/pkg-xcompile-test/run-matrix.sh $V
done
```

### Custom pkg build

```bash
./.claude/skills/pkg-xcompile-test/run-matrix.sh 22 /path/to/other/pkg/lib-es5/bin.js
```

### Custom work directory

By default build outputs go to `/tmp/pkg-xcompile/bin-node<major>/`. Override with:

```bash
PKG_XCOMPILE_WORKDIR=/somewhere/else ./.claude/skills/pkg-xcompile-test/run-matrix.sh 22
```

### Reading the output

Each cell is `BUILD / RUN`:

- `OK / OK` — works
- `OK / FAIL` — built, but runtime error on target
- `FAIL / n/a` — build failed
- `OK / SKIP-no-mac` — can't test macOS runtime on this host

## Known results (captured 2026-04-15)

Host: Ubuntu 24.04 x86_64, pkg HEAD of `docs/github-pages-site`. Tests run
with matching host-node / target-node major.

### Node 20

| target      | std      | std-public | sea                            |
| ----------- | -------- | ---------- | ------------------------------ |
| linux-x64   | OK / OK  | OK / OK    | **FAIL** — SEA needs host ≥ 22 |
| linux-arm64 | OK / OK  | OK / OK    | FAIL (same)                    |
| win-x64     | OK / OK  | OK / OK    | FAIL (same)                    |
| macos-x64   | OK / n/a | OK / n/a   | FAIL (same)                    |
| macos-arm64 | OK / n/a | OK / n/a   | FAIL (same)                    |

Standard cross-compile on Node 20 **works without workarounds**.
SEA mode is unavailable because pkg enforces `host node ≥ 22`.

### Node 22

| target      | std           | std-public | sea      |
| ----------- | ------------- | ---------- | -------- |
| linux-x64   | OK / OK       | OK / OK    | OK / OK  |
| linux-arm64 | OK / **FAIL** | OK / OK    | OK / OK  |
| win-x64     | OK / **FAIL** | OK / OK    | OK / OK  |
| macos-x64   | OK / n/a      | OK / n/a   | OK / n/a |
| macos-arm64 | OK / n/a      | OK / n/a   | OK / n/a |

Standard cross-compile on Node 22 is **broken**:

- `linux-arm64` crashes at runtime with `Error: UNEXPECTED-20` in
  `readFileFromSnapshot`. Matches the [#181](https://github.com/yao-pkg/pkg/issues/181)
  failure mode.
- `win-x64` exits silently with EXIT=4 and no stdout. Matches the [#87](https://github.com/yao-pkg/pkg/issues/87)
  Windows silent-exit bug.

Both are fixed by adding `--public-packages "*" --public` (which skips the
V8 bytecode step). Enhanced SEA avoids both out of the box.

### Node 24

| target      | std      | std-public | sea      |
| ----------- | -------- | ---------- | -------- |
| linux-x64   | OK / OK  | OK / OK    | OK / OK  |
| linux-arm64 | OK / OK  | OK / OK    | OK / OK  |
| win-x64     | OK / OK  | OK / OK    | OK / OK  |
| macos-x64   | OK / n/a | OK / n/a   | OK / n/a |
| macos-arm64 | OK / n/a | OK / n/a   | OK / n/a |

Node 24 **works out of the box** for Standard and SEA, same as Node 20.
The Node 22 bug is a Node-22-specific `pkg-fetch` patch regression, not
a permanent Standard-mode limitation.

### macOS runtime

Not verified — see "Host requirements" above. The regressions tracked
in [#181](https://github.com/yao-pkg/pkg/issues/181) (macOS host, Node 22+) must be confirmed on a real Mac.
GitHub Actions' `macos-13` / `macos-14` runners are the right place for
that; a follow-up CI workflow that runs the hello.js matrix there would
close the last hole.

## The script

The harness lives next to this `SKILL.md` as `run-matrix.sh`. Before
first run, set `PKG_BIN` to your pkg build and ensure `nvm` is sourced.

## Quick reference of pkg flags touched

| Flag                             | Effect                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `-t nodeNN-<os>-<arch>`          | Target triple                                                                                                          |
| `--sea`                          | Enhanced SEA mode                                                                                                      |
| `--public-packages "*" --public` | Disable V8 bytecode, include sources in plaintext — the cross-compile escape hatch for Standard mode                   |
| `--no-bytecode`                  | Same effect for bytecode, but does not imply `--public` — use with `--public-packages` if you want consistent behavior |
| `--debug`                        | Inject diagnostic bootstrap; enables `DEBUG_PKG` at runtime                                                            |

## Notes for future maintainers

- Do **not** reuse cached binaries between matrix runs — delete
  `bin-node${major}/` first if you rebuilt pkg. pkg does not hash its
  own source into the output, so stale binaries silently hide regressions.
- If you add a new target to the matrix, also add a runner branch in
  `run_one()`. Unknown targets fall through the `case` and count as pass.
- If `scottyhardy/docker-wine` becomes unavailable, `tobix/wine` is a
  smaller drop-in replacement — it has the same EBADF stdout gotcha.
- Don't confuse "builds with warning" with "builds clean". The matrix
  only records `OK` when the binary file exists on disk; a warning like
  `Failed to make bytecode node22-arm64` still produces a binary but it
  will crash at runtime. Runtime is the source of truth.
