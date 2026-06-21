#!/usr/bin/env bash
#
# maybe-bump-embed-kit.sh — auto-cut the embed-kit `v*` tag when (and only when)
# a change touches the code the kit is BUILT from.
#
# Why this exists
# ---------------
# The engine ships two independent version lines:
#   • npm umbrella  `onda-engine`     → tags `onda-engine-v*`, owned by Release-Please
#   • embed-kit     (Studio vendor)   → tags `v*`,             cut by hand until now
#
# Release-Please is path-scoped to packages/umbrella, so it never sees the Rust
# crates / wasm / vendored TS the kit is actually built from — which means the
# kit tag was a manual, forgettable step. This closes that gap: run this (or let
# CI run it on push to main) and it cuts the next `v*` tag IFF a kit input changed.
# Pushing that tag is what triggers .github/workflows/release.yml to build and
# publish the kit tarball.
#
# Kit inputs (must match what scripts/build-embed-kit.sh consumes):
#   • the `onda` binary  → every Rust crate (packages/*-rs/) + Cargo.toml/Cargo.lock
#   • the text-metrics wasm → packages/wasm/
#   • the vendored TS    → packages/{cinema,render,react,components}/ + .vendor-entry.mjs
#   • the kit build itself → scripts/build-embed-kit.sh, scripts/onda-engine.d.ts
#
# Usage:
#   scripts/maybe-bump-embed-kit.sh             cut + push the next v* tag if needed
#   scripts/maybe-bump-embed-kit.sh --dry-run   print the decision, change nothing
#   scripts/maybe-bump-embed-kit.sh --check     exit 1 if a bump is needed (CI gate)
#
# Bumps PATCH by default (kit rebuilds are overwhelmingly patch-level). Override
# with: BUMP=minor scripts/maybe-bump-embed-kit.sh
#
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mode="apply"
case "${1:-}" in
  "")          mode="apply" ;;
  --dry-run)   mode="dry"   ;;
  --check)     mode="check" ;;
  -h|--help)   grep -E '^# ' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)           echo "error: unknown arg '$1' (try --dry-run | --check | --help)" >&2; exit 2 ;;
esac

# Paths whose changes mean the kit MUST be rebuilt. Keep in sync with the header.
kit_paths_regex='^(Cargo\.(toml|lock)|packages/[^/]+-rs/|packages/(cinema|render|react|components|wasm)/|\.vendor-entry\.mjs|scripts/(build-embed-kit\.sh|onda-engine\.d\.ts))'

# Latest embed-kit tag (vX.Y.Z) — NOT the npm line (onda-engine-v*).
last_tag="$(git tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)"
if [ -z "$last_tag" ]; then
  echo "error: no existing v* embed-kit tag found — cut an initial one by hand first." >&2
  exit 1
fi

changed="$(git diff --name-only "${last_tag}..HEAD" || true)"
kit_changed="$(printf '%s\n' "$changed" | grep -E "$kit_paths_regex" || true)"

if [ -z "$kit_changed" ]; then
  echo "embed-kit: no kit-relevant changes since ${last_tag} — nothing to release."
  exit 0
fi

# Compute the next version.
ver="${last_tag#v}"
IFS=. read -r major minor patch <<EOF
$ver
EOF
case "${BUMP:-patch}" in
  major) next="v$((major+1)).0.0" ;;
  minor) next="v${major}.$((minor+1)).0" ;;
  patch) next="v${major}.${minor}.$((patch+1))" ;;
  *)     echo "error: BUMP must be major|minor|patch (got '${BUMP}')" >&2; exit 2 ;;
esac

echo "embed-kit: kit inputs changed since ${last_tag}:"
printf '%s\n' "$kit_changed" | sed 's/^/  • /' | head -25
extra=$(printf '%s\n' "$kit_changed" | wc -l | tr -d ' ')
[ "$extra" -gt 25 ] && echo "  … and $((extra-25)) more"
echo "embed-kit: → next tag ${next}"

case "$mode" in
  dry)   echo "(dry-run — no tag created)"; exit 0 ;;
  check) echo "(check — a bump is needed)"; exit 1 ;;
  apply)
    git tag "$next"
    git push origin "$next"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
      # A tag pushed with the default GITHUB_TOKEN does NOT trigger release.yml
      # (Actions' recursion guard), but workflow_dispatch by GITHUB_TOKEN DOES
      # (documented exception) — so fire it explicitly on the new tag.
      gh workflow run release.yml --ref "$next"
      echo "embed-kit: pushed ${next} + dispatched release.yml on it."
    else
      echo "embed-kit: pushed ${next} → release.yml will build + publish the kit tarball."
    fi
    ;;
esac
