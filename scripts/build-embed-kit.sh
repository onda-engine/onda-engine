#!/usr/bin/env bash
# Build the ONDA Studio vendor bundle — the exact set of artifacts ONDA Studio
# vendors (backend/vendor/onda/): the bun-bundled JS engine entry + its .d.ts,
# the `onda` CLI binary, the synth_json/beats_json audio tools, the text-metrics
# wasm, and a manifest stamping what was built. Replaces the hand-copy loop
# (no more .bak files, no more stale d.ts).
#
# Usage:
#   scripts/build-embed-kit.sh [--out <dir>] [--skip-binary]
#
#   --out <dir>     Output directory (default: dist/embed-kit/)
#   --skip-binary   Skip the cargo --release builds (JS/d.ts/wasm/manifest only)
#
# Requires: pnpm, bun; cargo + rustc unless --skip-binary; git (optional —
# the manifest says "unknown"/dirty=false without it).

set -euo pipefail

# ── Repo root (script lives in scripts/) ─────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── Args ─────────────────────────────────────────────────────────────────────
OUT="dist/embed-kit"
SKIP_BINARY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      [[ $# -ge 2 ]] || { echo "error: --out needs a directory argument" >&2; exit 2; }
      OUT="$2"; shift 2 ;;
    --skip-binary)
      SKIP_BINARY=1; shift ;;
    -h|--help)
      sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)
      echo "error: unknown argument '$1' (usage: $0 [--out <dir>] [--skip-binary])" >&2
      exit 2 ;;
  esac
done

mkdir -p "$OUT"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# ── 1. TS dists the vendor entry imports (.vendor-entry.mjs → packages/*/dist) ─
step "Building @onda TS dists (react, components, cinema, render)"
pnpm --filter @onda-engine/react --filter @onda-engine/components --filter @onda-engine/cinema \
  --filter @onda-engine/render build

# ── 2. Bundle the vendor entry (React + @onda-engine/* inlined, Node ESM) ───────────
step "Bundling .vendor-entry.mjs -> $OUT/onda-engine.js"
bun build .vendor-entry.mjs --target node --format esm --outfile "$OUT/onda-engine.js"

# ── 3. Type declarations (checked-in source of truth: scripts/onda-engine.d.ts) ─
step "Copying onda-engine.d.ts"
cp scripts/onda-engine.d.ts "$OUT/onda-engine.d.ts"

# ── 4. Native binaries: the CLI + the audio tools ────────────────────────────
if [[ "$SKIP_BINARY" -eq 0 ]]; then
  step "Building native binaries (onda, synth_json, beats_json) --release"
  # `segment` bakes U²-Net subject segmentation (text-behind-subject, auto-
  # reframe) into the binary — onnxruntime statically linked (~+24MB). The
  # model itself (~176MB) downloads once at first use to ~/.onda/models/.
  # `video` enables native A-roll decode for export (onda-video shells to the
  # ffmpeg CLI; near-zero binary cost). Without it, Video nodes render nothing.
  # `transcribe` bakes Whisper speech-to-text (whisper.cpp) into the binary for
  # `onda transcribe` (one-click captions + text-based editing). BUILD-TIME DEPS:
  # cmake + a C++ toolchain (whisper.cpp is compiled from source) — macOS has
  # these via Homebrew/Xcode; Linux CI needs `apt-get install cmake`. The Whisper
  # model (~142MB base.en) downloads once at first use to ~/.onda/models/.
  # `speak` bakes Kokoro-82M AI voiceover into the binary for `onda speak` (the
  # engine half of Studio narration). BUILD-TIME DEPS: cmake + clang (espeak-ng,
  # the phonemizer, is compiled from bundled C source via cmake+bindgen) AND a
  # complete espeak-ng-data on disk for the phoneme tables — i.e. an espeak-ng
  # install (macOS: `brew install espeak-ng`; Debian/Ubuntu CI: `apt-get install
  # cmake clang espeak-ng espeak-ng-data`). NO system espeak-ng is needed at RUN
  # time. The Kokoro model (~325MB) + voices (~28MB) download once at first use
  # to ~/.onda/models/.
  cargo build --release -p onda-cli --features segment,video,transcribe,speak
  cargo build --release -p onda-audio --example synth_json --example beats_json
  cp target/release/onda "$OUT/onda"
  cp target/release/examples/synth_json "$OUT/synth_json"
  cp target/release/examples/beats_json "$OUT/beats_json"
else
  step "Skipping native binaries (--skip-binary)"
fi

# ── 5. Text-metrics wasm ─────────────────────────────────────────────────────
WASM="packages/wasm/pkg/onda_wasm_bg.wasm"
if [[ ! -f "$WASM" ]]; then
  echo "error: $WASM not found — build it first with:" >&2
  echo "  pnpm --filter @onda-engine/wasm build" >&2
  echo "(cargo build -p onda-wasm --target wasm32-unknown-unknown --release + wasm-bindgen)" >&2
  exit 1
fi
step "Copying $WASM"
cp "$WASM" "$OUT/onda_wasm_bg.wasm"

# ── 6. Manifest ──────────────────────────────────────────────────────────────
step "Writing $OUT/manifest.json"
VERSION="$(sed -n '/^\[workspace\.package\]/,/^\[/p' Cargo.toml \
  | sed -n 's/^version *= *"\(.*\)"/\1/p' | head -n1)"
[[ -n "$VERSION" ]] || { echo "error: could not read [workspace.package] version from Cargo.toml" >&2; exit 1; }
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TARGET="$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')"
[[ -n "$TARGET" ]] || TARGET="unknown"
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then DIRTY=true; else DIRTY=false; fi

cat > "$OUT/manifest.json" <<EOF
{
  "name": "onda-embed-kit",
  "version": "$VERSION",
  "gitSha": "$GIT_SHA",
  "builtAt": "$BUILT_AT",
  "target": "$TARGET",
  "dirty": $DIRTY
}
EOF

step "Done"
echo "Bundle written to $OUT/:"
ls -lh "$OUT"
