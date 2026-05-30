#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.1.0"
  exit 1
fi

echo "=== x402-plugins release $VERSION ==="

if [[ -n "$(git status --porcelain)" ]]; then
  echo "x402: working tree is not clean — commit or stash changes first"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "x402: gh CLI not authenticated — run 'gh auth login'"
  exit 1
fi

echo "-> clean"
npm run clean

echo "-> install"
npm ci

echo "-> build"
npm run build

echo "-> typecheck"
npm run typecheck

echo "-> test"
npm run smoke

echo "-> pack"
mkdir -p artifacts
for pkg in packages/*/; do
  (cd "$pkg" && npm pack --pack-dest ../../artifacts)
done

echo "-> tag"
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin "v$VERSION"

echo "-> release"
gh release create "v$VERSION" \
  --title "x402-plugins v$VERSION" \
  --notes-file CHANGELOG.md \
  artifacts/*.tgz

echo "=== Release v$VERSION complete ==="
