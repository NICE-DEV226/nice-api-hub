# nah — CLI and terminal UI for NICE-API'HUB

One binary, two ways to use it:

- **Commands** for scripts and quick lookups (`nah media`, `nah download`, `nah admin …`), with `--json` and
  meaningful exit codes.
- **A full-screen interface** (`nah tui`) built with [Bubble Tea](https://github.com/charmbracelet/bubbletea):
  live dashboard, account and key management, and a media playground with a download progress bar.

Built in Go with the Charm stack (Bubble Tea, Bubbles, Lip Gloss) and Cobra. Static binary, no runtime needed.

## Install

```bash
cd apps/cli
make build            # ./bin/nah
make install          # into $GOBIN (~/go/bin)
make dist             # release binaries for linux/darwin/windows (amd64, arm64) + SHA256SUMS
```

Shell completion: `nah completion bash|zsh|fish|powershell`.

## Get started

```bash
nah login             # asks for the gateway URL, an API key (customer) and/or an admin token (operator)
nah status            # health and platform availability (needs no credentials)
nah tui               # the full-screen interface
```

`nah login` **checks the credentials against the gateway before saving them**, asks for secrets without echo, and
stores them in a private file (`~/.config/nah/config.json`, mode `0600`). Non-interactively:
`printf '%s\n' "$KEY" | nah login --api-key-stdin`.

Settings resolve in this order: flag → environment → profile → default.
`NAH_URL`, `NAH_API_KEY`, `NAH_ADMIN_TOKEN`, `NAH_PROFILE`, `NAH_CONFIG` (file path). Several gateways? Use profiles:
`nah login --profile staging`, `nah config use staging`, `nah --profile prod status`.

## Commands

**Customer** (API key)

| Command | What it does |
|---|---|
| `nah media <url>` | Resolve a URL into variants. `--url-only [--kind audio]` prints just a link |
| `nah download <url>` | One playable file (video+audio merged, or MP3). `-o`, `--max-height 720`, `--audio`, `--mp3`, `-f`, `-q` |
| `nah jobs submit <url>` | Asynchronous extraction. `--wait`, `--webhook URL`, `--idempotency-key K`; then `jobs get/wait <id>` |
| `nah account` · `nah usage` | Plan, limits, webhook secret (`--show-secret`), today's quota and recent usage |

**Operator** (admin token)

| Command | What it does |
|---|---|
| `nah admin plans` | List plans |
| `nah admin accounts list \| get \| create \| suspend \| activate \| set-plan` | Manage customers. Accounts can be referenced by id, id prefix, or name |
| `nah admin keys list \| create \| revoke \| rotate` | Issue keys (shown once), revoke, rotate with a grace period |
| `nah admin usage <account>` · `nah admin webhook-secret rotate <account>` | Consumption, signing secret |

Destructive actions (revoke, suspend, rotate a secret) ask for confirmation, and refuse to run without `--yes` when
there is no terminal, so a script can never do them by accident.

`nah status` exits `1` when the gateway is not ready or a platform is down, so it doubles as a health check.

## Terminal UI

`nah tui` adapts to your credentials: **Dashboard** always; **Accounts** with the admin token; **Playground** with an API key.

| Key | Action |
|---|---|
| `1` `2` `3` · `[` `]` | Switch tabs |
| `?` · `q` · `ctrl+c` | Full help · quit · quit (also cancels a download) |
| **Dashboard** `r` | Refresh (it also refreshes itself every 15 s) |
| **Accounts** `↑↓` `tab` | Move · switch between accounts and keys |
| `n` · `c` · `x` · `s` · `r` | New account · new key · revoke key · suspend/activate · refresh |
| **Playground** `enter` | Resolve the URL you typed |
| `↑↓` · `d` · `m` · `c` · `esc` | Select · download · MP3 · copy link (OSC 52) · new URL |

A new key is displayed once, with a copy shortcut. Revocations and suspensions ask for `y` first. While you type in a
text box, single-letter shortcuts are disabled so a URL containing a `q` never quits the app.

## Scripting

- `--json` prints the API's data as JSON on stdout; **errors then go to stderr as JSON** (`{"error":{"code":…}}`).
- Exit codes: `0` ok · `1` failure · `2` usage error · `3` missing/invalid credentials · `130` cancelled.
- `nah download -q` prints only the saved path. Downloads are written to a `.part` file and renamed on success, so a
  cancelled or failed transfer never leaves a truncated file behind, and existing files are not overwritten without `-f`.
- Spinners and progress bars go to **stderr** and only when it is a terminal: pipes and CI logs stay clean.

```bash
URL=$(nah media --url-only --kind audio "$SRC")          # best audio link
nah download "$SRC" --mp3 -q -o ~/Music/                 # -> /home/me/Music/<title>.mp3
nah status --json | jq -r '.platforms[] | select(.status=="down").name'
```

## Development

```bash
make test        # unit + interface tests
make race        # with the race detector
```

Layout: `cmd/` (Cobra commands), `internal/api` (typed gateway client), `internal/tui` (the Bubble Tea app and the
download/spinner widgets), `internal/dl` (safe file saving), `internal/config`, `internal/ui` (shared look).
The interface is tested with `teatest` against a fake gateway (tabs, forms, confirmations, downloads), and the commands
against `httptest`, including exit codes and the "nothing is sent without confirmation" guarantees.
