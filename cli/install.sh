#!/bin/sh
# nah installer for Linux and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/NICE-DEV226/nice-api-hub/main/cli/install.sh | sh
#
# The copy attached to a release installs exactly that release. The copy in the repository installs the latest one.
# Windows: use install.ps1.
#
# Options: flags after `sh -s --`, or environment variables (handy with a pipe).
#   --version X.Y.Z     NAH_VERSION       install this version
#   --pre               NAH_PRE=1         when picking "the latest", accept pre-releases too
#   --dir DIR           NAH_INSTALL_DIR   where to put nah (default: ~/.local/bin, or /usr/local/bin when run as root)
#   -h, --help
# For mirrors and tests:
#   NAH_DOWNLOAD_BASE   base URL that holds nah_<version>_<os>_<arch>.tar.gz and SHA256SUMS
#   NAH_RELEASES_API    URL of the list of releases (default: the GitHub API)
#
# What it does: works out your system, downloads the archive, CHECKS IT against the release's SHA256SUMS (and refuses to
# install on any mismatch), unpacks it and puts `nah` in place atomically. It never uses sudo and touches nothing else.
# To uninstall: delete the `nah` file it printed, and (optionally) the folder ~/.config/nah.
set -eu

REPO="NICE-DEV226/nice-api-hub"
# Filled in by the release workflow in the copy attached to a release; left as is in the repository.
PINNED="__NAH_PINNED_VERSION__"
UNPINNED="__NAH_PINNED""_VERSION__"

VERSION="${NAH_VERSION:-}"
PRE="${NAH_PRE:-}"
DIR="${NAH_INSTALL_DIR:-}"
BASE="${NAH_DOWNLOAD_BASE:-}"
API="${NAH_RELEASES_API:-https://api.github.com/repos/$REPO/releases?per_page=100}"

say() { printf '%s\n' "$*" >&2; }
fail() { say "nah install: $*"; exit 1; }

usage() {
  sed -n '2,21p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' >&2 || true
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) [ $# -ge 2 ] || fail "--version needs a value"; VERSION="$2"; shift 2 ;;
    --version=*) VERSION="${1#--version=}"; shift ;;
    --pre) PRE=1; shift ;;
    --dir) [ $# -ge 2 ] || fail "--dir needs a value"; DIR="$2"; shift 2 ;;
    --dir=*) DIR="${1#--dir=}"; shift ;;
    -h|--help) usage 0 ;;
    *) fail "unknown option: $1 (try --help)" ;;
  esac
done

# --- what we need ------------------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
  fetch() { # url dest
    if [ -n "${GITHUB_TOKEN:-}" ] && [ "${1#https://api.github.com/}" != "$1" ]; then
      curl -fsSL --retry 3 --connect-timeout 15 -H "Authorization: Bearer $GITHUB_TOKEN" -o "$2" "$1"
    else
      curl -fsSL --retry 3 --connect-timeout 15 -o "$2" "$1"
    fi
  }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  fail "needs curl or wget"
fi
command -v tar >/dev/null 2>&1 || fail "needs tar"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | sed 's/^.*= //'
  else fail "needs sha256sum, shasum or openssl to check the download"
  fi
}

# --- which system ------------------------------------------------------------------
case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  MINGW*|MSYS*|CYGWIN*) fail "this is Windows: use install.ps1 (see the README)" ;;
  *) fail "unsupported system: $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) fail "unsupported processor: $(uname -m) (nah is built for amd64 and arm64)" ;;
esac
# A shell running under Rosetta reports x86_64 on an Apple Silicon Mac: the native build is the right one.
if [ "$OS" = darwin ] && [ "$ARCH" = amd64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  ARCH=arm64
fi

# --- which version -----------------------------------------------------------------
TMP="$(mktemp -d 2>/dev/null || mktemp -d -t nah)"
trap 'rm -rf "$TMP"' EXIT INT TERM

if [ -z "$VERSION" ] && [ "$PINNED" != "$UNPINNED" ]; then
  VERSION="$PINNED"
fi
VERSION="${VERSION#cli/}"; VERSION="${VERSION#v}"

if [ -z "$VERSION" ]; then
  say "Looking for the latest release..."
  fetch "$API" "$TMP/releases.json" || fail "could not reach $API"
  # Pair every release's tag with its pre-release flag (both appear once per release, in the same order).
  grep -o '"tag_name": *"[^"]*"' "$TMP/releases.json" | sed 's/.*"\([^"]*\)"$/\1/' >"$TMP/tags"
  grep -o '"prerelease": *[a-z]*' "$TMP/releases.json" | sed 's/.*: *//' >"$TMP/pre"
  STABLE=""; ANY=""
  n=0
  while IFS= read -r tag; do
    n=$((n + 1))
    case "$tag" in cli/v*) ;; *) continue ;; esac
    flag="$(sed -n "${n}p" "$TMP/pre")"
    [ -n "$ANY" ] || ANY="$tag"
    if [ "$flag" = false ] && [ -z "$STABLE" ]; then STABLE="$tag"; fi
  done <"$TMP/tags"
  if [ -n "$STABLE" ] && [ -z "$PRE" ]; then TAGNAME="$STABLE"
  elif [ -n "$ANY" ]; then
    TAGNAME="$ANY"
    case "$TAGNAME" in *-*) say "No final release yet: installing the pre-release ${TAGNAME#cli/v}." ;; esac
  else
    fail "no nah release found at $API"
  fi
  VERSION="${TAGNAME#cli/v}"
fi
case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) fail "'$VERSION' is not a version like 1.2.3 or 1.2.3-rc.1" ;;
esac

FILE="nah_${VERSION}_${OS}_${ARCH}.tar.gz"
[ -n "$BASE" ] || BASE="https://github.com/$REPO/releases/download/cli/v$VERSION"
BASE="${BASE%/}"

# --- download and check ---------------------------------------------------------------
say "Installing nah $VERSION for $OS/$ARCH..."
fetch "$BASE/$FILE" "$TMP/$FILE" || fail "could not download $BASE/$FILE (is $VERSION a release for $OS/$ARCH?)"
fetch "$BASE/SHA256SUMS" "$TMP/SHA256SUMS" || fail "could not download $BASE/SHA256SUMS"
WANT="$(grep " $FILE\$" "$TMP/SHA256SUMS" | cut -d' ' -f1 | head -n1)"
[ -n "$WANT" ] || fail "$FILE is not listed in SHA256SUMS"
GOT="$(sha256_of "$TMP/$FILE")"
if [ "$WANT" != "$GOT" ]; then
  fail "the download does not match its checksum (expected $WANT, got $GOT). Nothing was installed."
fi
say "Checksum OK."

# --- unpack and install -----------------------------------------------------------------
tar -xzf "$TMP/$FILE" -C "$TMP" || fail "could not unpack $FILE"
SRC="$TMP/nah_${VERSION}_${OS}_${ARCH}/nah"
[ -f "$SRC" ] || fail "the archive does not contain nah"

if [ -z "$DIR" ]; then
  if [ "$(id -u)" = 0 ]; then DIR=/usr/local/bin; else DIR="$HOME/.local/bin"; fi
fi
mkdir -p "$DIR" 2>/dev/null || fail "cannot create $DIR (try --dir with a folder you own)"
[ -w "$DIR" ] || fail "cannot write to $DIR (try --dir ~/.local/bin, or run with sudo)"
# Copy next to the target, then rename: replacing a program that is running must be atomic.
if ! { cp "$SRC" "$DIR/.nah.new.$$" && chmod 755 "$DIR/.nah.new.$$" && mv -f "$DIR/.nah.new.$$" "$DIR/nah"; }; then
  rm -f "$DIR/.nah.new.$$"
  fail "could not put nah in $DIR"
fi

say ""
say "nah $VERSION is installed: $DIR/nah"
"$DIR/nah" version >&2 || fail "the installed program does not run"

case ":${PATH:-}:" in
  *":$DIR:"*) ;;
  *)
    say ""
    say "$DIR is not on your PATH. Add it, for example:"
    say "  echo 'export PATH=\"$DIR:\$PATH\"' >> ~/.profile   # then open a new terminal"
    ;;
esac
OTHER="$(command -v nah 2>/dev/null || true)"
if [ -n "$OTHER" ] && [ "$OTHER" != "$DIR/nah" ]; then
  say ""
  say "Note: another nah comes first on your PATH: $OTHER"
fi
say ""
say "Run: nah        (later: nah update)"
