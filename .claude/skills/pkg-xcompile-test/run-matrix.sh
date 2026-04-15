#!/usr/bin/env bash
# Cross-compile test matrix for @yao-pkg/pkg
#
# Usage: run-matrix.sh <node-major> [pkg-bin]
#   node-major : 20, 22, or 24. The script switches to the matching nvm node
#                version so the pkg host major matches the target major
#                (SEA's blob generator needs this — otherwise pkg tries to
#                run the downloaded target-arch node binary during build).
#   pkg-bin    : path to pkg entry (default: <repo-root>/lib-es5/bin.js,
#                resolved from this script's location)
#
# Build outputs go to $PKG_XCOMPILE_WORKDIR (default /tmp/pkg-xcompile) so
# the repo stays clean. The tiny hello.js + package.json fixtures are kept
# next to this script and copied into the workdir on first run.
#
# Per-cell logs are written to $PKG_XCOMPILE_WORKDIR/logs/ and their paths
# are printed to stderr next to any FAIL so a failing cell can be inspected
# without re-running the whole matrix.
#
# Builds a tiny hello.js for every {mode,target} combination and runs what
# can be executed on this Linux host (native x64, arm64 via docker+qemu,
# win-x64 via scottyhardy/docker-wine). macOS runtime is skipped (no KVM).

set -euo pipefail

NODE_MAJOR="${1:-22}"

# Resolve repo root from the script location: .claude/skills/<name>/run-matrix.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

PKG_BIN="${2:-$REPO_ROOT/lib-es5/bin.js}"
WORKDIR="${PKG_XCOMPILE_WORKDIR:-/tmp/pkg-xcompile}"
BINDIR="$WORKDIR/bin-node$NODE_MAJOR"
LOGDIR="$WORKDIR/logs/node$NODE_MAJOR"
mkdir -p "$WORKDIR" "$BINDIR" "$LOGDIR"

if [[ ! -f "$PKG_BIN" ]]; then
  echo "pkg not built at $PKG_BIN — run 'yarn build' in $REPO_ROOT first." >&2
  exit 1
fi

unset NODE_OPTIONS  # strip VSCode JS debug bootloader if present

# Switch host node to match target major so we test the "user on matching
# node" case (important for SEA, which uses the host node to generate the
# blob when host major == target major).
if [[ -z "${NVM_DIR:-}" ]]; then export NVM_DIR="$HOME/.nvm"; fi
# shellcheck source=/dev/null
if [[ -s "$NVM_DIR/nvm.sh" ]]; then . "$NVM_DIR/nvm.sh"; fi
if command -v nvm >/dev/null 2>&1; then
  nvm use "$NODE_MAJOR" >/dev/null 2>&1 || {
    echo "nvm: no node $NODE_MAJOR installed. Run: nvm install $NODE_MAJOR" >&2
    exit 1
  }
fi
HOST_NODE_VER="$(node -v)"
echo "Host node: $HOST_NODE_VER" >&2
if [[ "$HOST_NODE_VER" != v${NODE_MAJOR}.* ]]; then
  echo "WARN: host node major ($HOST_NODE_VER) != requested ($NODE_MAJOR) — SEA builds may misbehave" >&2
fi

# --- Prepare tiny test project ----------------------------------------------
if [[ ! -f "$WORKDIR/hello.js" ]]; then
  cat > "$WORKDIR/hello.js" <<'EOF'
console.log('hello from pkg', process.platform, process.arch, process.version);
EOF
fi
if [[ ! -f "$WORKDIR/package.json" ]]; then
  cat > "$WORKDIR/package.json" <<'EOF'
{ "name": "hello-pkg", "version": "1.0.0", "bin": "hello.js", "pkg": { "scripts": [] } }
EOF
fi

# --- Matrix ------------------------------------------------------------------
TARGETS=(linux-x64 linux-arm64 win-x64 macos-x64 macos-arm64)
MODES=(std std-public sea)

declare -A RESULT  # RESULT[mode/target] = "BUILD / RUN"

# build_one: writes "OK" | "MISSING" | "FAIL" to stdout, progress/log path
# to stderr. Always returns 0 so command substitution never aborts the loop.
build_one() {
  local mode="$1" target="$2"
  local out="$BINDIR/${mode}-${target}"
  [[ "$target" == win-* ]] && out="${out}.exe"
  local buildlog="$LOGDIR/build-${mode}-${target}.log"

  local args=(hello.js -t "node${NODE_MAJOR}-${target}" -o "$out")
  case "$mode" in
    sea) args+=(--sea) ;;
    std-public) args+=(--public-packages '*' --public) ;;
  esac

  echo "  build: $mode → $target" >&2
  if (cd "$WORKDIR" && node "$PKG_BIN" "${args[@]}" >"$buildlog" 2>&1); then
    if [[ -f "$out" ]]; then
      echo "OK"
    else
      echo "MISSING"
      echo "    log: $buildlog" >&2
    fi
  else
    echo "FAIL"
    echo "    log: $buildlog" >&2
  fi
  return 0
}

# run_one: same stdout/stderr contract as build_one.
run_one() {
  local mode="$1" target="$2"
  local bin="$BINDIR/${mode}-${target}"
  [[ "$target" == win-* ]] && bin="${bin}.exe"
  if [[ ! -f "$bin" ]]; then
    echo "SKIP-no-bin"
    return 0
  fi
  local runlog="$LOGDIR/run-${mode}-${target}.log"

  case "$target" in
    linux-x64)
      if "$bin" </dev/null >"$runlog" 2>&1 && grep -q "hello from pkg" "$runlog"; then
        echo "OK"
      else
        echo "FAIL"
        echo "    log: $runlog" >&2
      fi
      ;;
    linux-arm64)
      if docker run --rm --platform linux/arm64 -v "$BINDIR:/mnt" ubuntu:latest \
          "/mnt/$(basename "$bin")" </dev/null >"$runlog" 2>&1 \
        && grep -q "hello from pkg" "$runlog"; then
        echo "OK"
      else
        echo "FAIL"
        echo "    log: $runlog" >&2
      fi
      ;;
    win-x64)
      # Wine in non-tty docker breaks Node stdout unless we redirect to a
      # file inside the container, then cat it back.
      docker run --rm -v "$BINDIR:/mnt" scottyhardy/docker-wine \
        bash -c "wine '/mnt/$(basename "$bin")' </dev/null >/tmp/out 2>/tmp/err; cat /tmp/out" \
        >"$runlog" 2>/dev/null || true
      if grep -q "hello from pkg" "$runlog"; then
        echo "OK"
      else
        echo "FAIL"
        echo "    log: $runlog" >&2
      fi
      ;;
    macos-*)
      echo "SKIP-no-mac"
      ;;
    *)
      echo "SKIP-unknown"
      ;;
  esac
  return 0
}

# --- Execute ----------------------------------------------------------------
echo "=== node $NODE_MAJOR | pkg: $PKG_BIN ==="
for mode in "${MODES[@]}"; do
  for target in "${TARGETS[@]}"; do
    b="$(build_one "$mode" "$target")"
    if [[ "$b" == "OK" ]]; then
      r="$(run_one "$mode" "$target")"
    else
      r="n/a"
    fi
    RESULT["$mode/$target"]="$b / $r"
  done
done

# --- Report -----------------------------------------------------------------
printf '\n=== Results (node %s) ===\n' "$NODE_MAJOR"
printf '%-12s | %-18s | %-18s | %-18s\n' target std std-public sea
printf '%s\n' "-------------|--------------------|--------------------|--------------------"
for target in "${TARGETS[@]}"; do
  printf '%-12s | %-18s | %-18s | %-18s\n' "$target" \
    "${RESULT[std/$target]}" "${RESULT[std-public/$target]}" "${RESULT[sea/$target]}"
done

printf '\nPer-cell logs: %s\n' "$LOGDIR"
