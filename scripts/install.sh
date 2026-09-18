#!/usr/bin/env bash
set -euo pipefail

# wt install script — downloads the binary matching the host OS/arch from
# GitHub Releases and installs it to ~/.local/bin/wt.
#
# Usage:
#   curl -fL https://raw.githubusercontent.com/zaratan/wt/main/scripts/install.sh | bash
#
# Optional env vars:
#   WT_VERSION       — pin a specific version (default: latest), e.g. "v0.1.0"
#   WT_INSTALL_DIR   — destination directory (default: ~/.local/bin)

REPO="zaratan/wt"
VERSION="${WT_VERSION:-latest}"
INSTALL_DIR="${WT_INSTALL_DIR:-$HOME/.local/bin}"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS-$ARCH" in
  Darwin-arm64) ASSET="wt-darwin-arm64" ;;
  Linux-x86_64) ASSET="wt-linux-x64" ;;
  *)
    echo "Unsupported platform: $OS $ARCH" >&2
    echo "(macOS Apple Silicon and Linux x86_64 only)" >&2
    exit 1
    ;;
esac

TARBALL="${ASSET}.tar.gz"

if [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/${REPO}/releases/latest/download"
else
  BASE="https://github.com/${REPO}/releases/download/${VERSION}"
fi

mkdir -p "$INSTALL_DIR"
DEST="${INSTALL_DIR}/wt"
TARBALL_TMP="${INSTALL_DIR}/.wt-tarball.tmp.$$"
SUMS_TMP="${INSTALL_DIR}/.wt-sha256sums.tmp.$$"
BIN_TMP="${DEST}.tmp.$$"

cleanup() { rm -f "$TARBALL_TMP" "$SUMS_TMP" "$BIN_TMP"; }
trap cleanup EXIT

echo "Downloading wt (${VERSION}) from GitHub Releases…"
# INVARIANT — nothing destructive before the final `mv`. Every write lands on a
# tmp path, so a truncated download can never leave a partial binary at $DEST.
curl -fL "${BASE}/${TARBALL}" -o "$TARBALL_TMP"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

warn_unverified() {
  echo "  warning: could not verify the download ($1); continuing." >&2
}

# Fail open on a missing sums file, hard-fail on a mismatch. The threat here is
# a truncated transfer, not a compromised origin: the tarball and SHA256SUMS
# come from the same release. Hard-failing on "absent" would break every
# install made against a release published before this file existed.
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  warn_unverified "no checksum tool on this machine"
elif ! curl -fsL "${BASE}/SHA256SUMS" -o "$SUMS_TMP" 2>/dev/null; then
  warn_unverified "this release publishes no SHA256SUMS"
else
  # awk alone, never `grep | awk`: under `set -o pipefail` a non-matching grep
  # exits 1 and would abort the whole script instead of falling through here.
  EXPECTED_SUM="$(awk -v f="$TARBALL" '$2 == f { print $1; exit }' "$SUMS_TMP")"
  if [ -z "$EXPECTED_SUM" ]; then
    warn_unverified "SHA256SUMS does not list ${TARBALL}"
  elif [ "$(sha256_of "$TARBALL_TMP")" != "$EXPECTED_SUM" ]; then
    echo "checksum mismatch for ${TARBALL}" >&2
    echo "Nothing was installed; any existing wt is untouched." >&2
    echo "This is almost always a dropped connection — run the install again." >&2
    exit 1
  fi
fi

tar -xzf "$TARBALL_TMP" -C "$INSTALL_DIR" "$ASSET"
mv "${INSTALL_DIR}/${ASSET}" "$BIN_TMP"
chmod +x "$BIN_TMP"
mv "$BIN_TMP" "$DEST"

echo "wt installed at ${DEST}"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    echo "  ${INSTALL_DIR} is not on your PATH. Add this to ~/.zshrc:"
    echo ""
    echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    echo "  Until then, run it as ${DEST}"
    ;;
esac

echo "wt drives herdr. If you do not have it: https://herdr.dev"
