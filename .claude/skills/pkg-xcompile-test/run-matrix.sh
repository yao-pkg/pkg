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
# Builds a tiny hello.js for every {mode,target} combination and runs what
# can be executed on this Linux host (native x64, arm64 via docker+qemu,
# win-x64 via scottyhardy/docker-wine). macOS runtime is skipped (no KVM).

set -u

NODE_MAJOR="${1:-22}"

# Resolve repo root from the script location: .claude/skills/<name>/run-matrix.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

PKG_BIN="${2:-$REPO_ROOT/lib-es5/bin.js}"
WORKDIR="${PKG_XCOMPILE_WORKDIR:-/tmp/pkg-xcompile}"
BINDIR="$WORKDIR/bin-node$NODE_MAJOR"
mkdir -p "$BINDIR"

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
echo "Host node: $(node -v)"

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

build_one() {
  local mode="$1" target="$2"
  local out="$BINDIR/${mode}-${target}"
  [[ "$target" == win-* ]] && out="${out}.exe"

  local args=(hello.js -t "node${NODE_MAJOR}-${target}" -o "$out")
  case "$mode" in
    sea) args+=(--sea) ;;
    std-public) args+=(--public-packages '*' --public) ;;
  esac

  echo "  build: $mode → $target"
  if (cd "$WORKDIR" && node "$PKG_BIN" "${args[@]}" >/tmp/pkg-build.log 2>&1); then
    [[ -f "$out" ]] && echo "OK" || echo "MISSING"
  else
    echo "FAIL"
  fi
}

run_one() {
  local mode="$1" target="$2"
  local bin="$BINDIR/${mode}-${target}"
  [[ "$target" == win-* ]] && bin="${bin}.exe"
  [[ ! -f "$bin" ]] && { echo "SKIP-no-bin"; return; }

  case "$target" in
    linux-x64)
      "$bin" </dev/null >/tmp/pkg-run.log 2>&1 && grep -q "hello from pkg" /tmp/pkg-run.log && echo "OK" || echo "FAIL"
      ;;
    linux-arm64)
      docker run --rm --platform linux/arm64 -v "$BINDIR:/mnt" ubuntu:latest \
        "/mnt/$(basename "$bin")" </dev/null >/tmp/pkg-run.log 2>&1 \
        && grep -q "hello from pkg" /tmp/pkg-run.log && echo "OK" || echo "FAIL"
      ;;
    win-x64)
      # Wine in non-tty docker breaks Node stdout unless we redirect to a
      # file inside the container, then cat it back.
      docker run --rm -v "$BINDIR:/mnt" scottyhardy/docker-wine \
        bash -c "wine '/mnt/$(basename "$bin")' </dev/null >/tmp/out 2>/tmp/err; cat /tmp/out" \
        >/tmp/pkg-run.log 2>/dev/null
      grep -q "hello from pkg" /tmp/pkg-run.log && echo "OK" || echo "FAIL"
      ;;
    macos-*)
      echo "SKIP-no-mac"
      ;;
  esac
}

# --- Execute ----------------------------------------------------------------
echo "=== node $NODE_MAJOR | pkg: $PKG_BIN ==="
for mode in "${MODES[@]}"; do
  for target in "${TARGETS[@]}"; do
    b=$(build_one "$mode" "$target" | tail -1)
    if [[ "$b" == "OK" ]]; then
      r=$(run_one "$mode" "$target")
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
