#!/usr/bin/env bash
# Exercises the installer and `nah update` for real, on the system this runs on, against release archives.
#
#   test-installers.sh DIST_DIR VERSION
#
# DIST_DIR holds what a release holds (nah_<version>_<os>_<arch>.tar.gz|zip and SHA256SUMS); VERSION is that release's version.
# A local server stands in for GitHub, so nothing is downloaded from or published to the internet. Needs bash, Python 3 and Go
# (to build an "old" nah to update). Works on Linux, macOS and Windows (Git Bash, with Windows PowerShell 5.1 and pwsh).
set -uo pipefail

[ $# -eq 2 ] || { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
DIST="$(cd "$1" && pwd)"
VERSION="$2"
CLI="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3 || command -v python)" || { echo "needs Python 3"; exit 2; }
T="$(mktemp -d)"
FAILS=0
SERVERS=""

case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  MINGW*|MSYS*|CYGWIN*) OS=windows ;;
  *) echo "unsupported system $(uname -s)"; exit 2 ;;
esac
EXT=""; [ "$OS" = windows ] && EXT=".exe"

cleanup() { for p in $SERVERS; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

ok() { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; FAILS=$((FAILS + 1)); }
check() { # description, then a command that must succeed
  local d="$1"; shift
  if "$@" >"$T/out" 2>&1; then ok "$d"; else bad "$d"; sed 's/^/        | /' "$T/out" | tail -12; fi
}
must_fail() { # description, then a command that must fail
  local d="$1"; shift
  if "$@" >"$T/out" 2>&1; then bad "$d (it succeeded)"; sed 's/^/        | /' "$T/out" | tail -8; else ok "$d"; fi
}
archive_for_os() { # dir -> the name of this system's archive in it
  local f
  for f in "$1"/*_"${OS}"_*; do basename "$f"; return; done
}
winpath() { if [ "$OS" = windows ]; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

serve() { # dir -> sets BASE and API
  local port="$T/port.$RANDOM"
  "$PY" "$CLI/scripts/serve-release.py" "$1" "$VERSION" --port-file "$port" >/dev/null 2>&1 &
  SERVERS="$SERVERS $!"
  local i=0
  while [ ! -s "$port" ] && [ $i -lt 100 ]; do sleep 0.1; i=$((i + 1)); done
  [ -s "$port" ] || { echo "the test server did not start"; exit 2; }
  BASE="http://127.0.0.1:$(cat "$port")/dl"
  API="http://127.0.0.1:$(cat "$port")/releases"
}

# --- run the right installer ------------------------------------------------------
# install DIR [extra env assignments...]: runs the installer into DIR (a POSIX path) with the given environment.
run_installer() {
  local dir="$1"; shift
  if [ "$OS" = windows ]; then
    local ps="$PS"
    env "$@" "$ps" -NoProfile -ExecutionPolicy Bypass -File "$(winpath "$CLI/install.ps1")" -Dir "$(winpath "$dir")" -NoPathUpdate
  else
    env "$@" NAH_INSTALL_DIR="$dir" sh "$CLI/install.sh"
  fi
}
reports_version() { "$1" version 2>&1 | grep -qF "nah $VERSION "; }

run_scenarios() {
  echo "== installer: $INSTALLER_NAME"
  serve "$DIST"; local base="$BASE" api="$API"
  local d="$T/inst.$RANDOM"

  check "installs an explicit version and it runs" \
    run_installer "$d/a" NAH_DOWNLOAD_BASE="$base" NAH_VERSION="$VERSION"
  check "the installed program reports version $VERSION" reports_version "$d/a/nah$EXT"

  check "finds the latest release through the releases list" \
    run_installer "$d/b" NAH_DOWNLOAD_BASE="$base" NAH_RELEASES_API="$api"
  check "  and that program runs too" reports_version "$d/b/nah$EXT"

  check "installing again over an existing nah works" \
    run_installer "$d/a" NAH_DOWNLOAD_BASE="$base" NAH_VERSION="$VERSION"
  check "  and leaves no temporary files behind" bash -c "[ \"\$(ls -A '$d/a' | wc -l | tr -d ' ')\" = 1 ]"

  # a copy pinned to this release, as attached to it, needs no version at all
  local pinned="$T/pinned.$RANDOM"; mkdir -p "$pinned"
  sed "s/__NAH_PINNED_VERSION__/$VERSION/" "$CLI/install.sh" >"$pinned/install.sh"
  sed "s/__NAH_PINNED_VERSION__/$VERSION/" "$CLI/install.ps1" >"$pinned/install.ps1"
  if [ "$OS" = windows ]; then
    check "the copy pinned to this release installs it without being told a version" \
      env NAH_DOWNLOAD_BASE="$base" "$PS" -NoProfile -ExecutionPolicy Bypass -File "$(winpath "$pinned/install.ps1")" -Dir "$(winpath "$d/c")" -NoPathUpdate
  else
    check "the copy pinned to this release installs it without being told a version" \
      env NAH_DOWNLOAD_BASE="$base" NAH_INSTALL_DIR="$d/c" sh "$pinned/install.sh"
  fi
  check "  and it is the pinned version" reports_version "$d/c/nah$EXT"

  # a download that does not match its checksum is refused, and nothing is installed
  local evil="$T/evil.$RANDOM"; mkdir -p "$evil"; cp "$DIST"/* "$evil"/
  local archive; archive="$(archive_for_os "$evil")"
  printf 'x' >>"$evil/$archive"
  serve "$evil"
  must_fail "a tampered archive is refused" \
    run_installer "$d/evil" NAH_DOWNLOAD_BASE="$BASE" NAH_VERSION="$VERSION"
  check "  and nothing was installed" bash -c "[ ! -e '$d/evil/nah$EXT' ]"
  BASE="$base"; API="$api"
}

run_update_scenarios() {
  echo "== nah update"
  serve "$DIST"; local base="$BASE" api="$API"
  local d="$T/upd.$RANDOM"; mkdir -p "$d/old"
  ( cd "$CLI" && go build -trimpath -ldflags "-X main.version=0.0.0-old" -o "$d/old/nah$EXT" . ) || { bad "could not build the old nah"; return; }
  local old="$d/old/nah$EXT"
  check "the old build reports its version" bash -c "'$old' version | grep -qF 'nah 0.0.0-old '"

  check "--check sees the new release" bash -c "NAH_UPDATE_API='$api' '$old' update --check --pre | grep -qF '$VERSION'"

  # a tampered download must leave the old program exactly as it was
  local evil="$T/uevil.$RANDOM"; mkdir -p "$evil"; cp "$DIST"/* "$evil"/
  local archive; archive="$(archive_for_os "$evil")"
  printf 'x' >>"$evil/$archive"
  serve "$evil"
  must_fail "an update from a tampered download is refused" env NAH_UPDATE_API="$API" "$old" update --pre --yes
  check "  and the old program still works, unchanged" bash -c "'$old' version | grep -qF 'nah 0.0.0-old '"

  check "updates itself to $VERSION" env NAH_UPDATE_API="$api" "$old" update --pre --yes
  check "  the program is now $VERSION" reports_version "$old"
  check "  and no leftovers remain beside it" bash -c "[ \"\$(ls -A '$d/old' | grep -c .)\" = 1 ]"
  check "asking again says it is up to date" bash -c "NAH_UPDATE_API='$api' '$old' update --check | grep -qi 'up to date'"
}

if [ "$OS" = windows ]; then
  for PS in powershell.exe pwsh; do
    command -v "$PS" >/dev/null 2>&1 || { echo "(skipping $PS: not installed)"; continue; }
    INSTALLER_NAME="install.ps1 in $PS"; run_scenarios
    # the one-line form people are told to type
    serve "$DIST"
    d="$T/iex.$RANDOM"
    check "the one-line form (... | iex) works in $PS" \
      env NAH_DOWNLOAD_BASE="$BASE" NAH_VERSION="$VERSION" NAH_INSTALL_DIR="$(winpath "$d")" \
      "$PS" -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Raw '$(winpath "$CLI/install.ps1")' | Invoke-Expression"
    check "  and it installed a working program" reports_version "$d/nah$EXT"
  done
else
  INSTALLER_NAME="install.sh"; run_scenarios
  # the one-line form people are told to type
  serve "$DIST"
  d="$T/pipe.$RANDOM"
  check "the one-line form (cat install.sh | sh) works" \
    bash -c "cat '$CLI/install.sh' | NAH_DOWNLOAD_BASE='$BASE' NAH_VERSION='$VERSION' NAH_INSTALL_DIR='$d' sh"
  check "  and it installed a working program" reports_version "$d/nah"
fi
run_update_scenarios

echo
if [ "$FAILS" -eq 0 ]; then echo "All installer and update checks passed on $OS."; else echo "$FAILS check(s) failed on $OS."; exit 1; fi
