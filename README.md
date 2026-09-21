# NICE-API'HUB

**Grab media from social platforms, from your terminal or from your own code.**

NICE-API'HUB turns a link (YouTube, TikTok, X, Instagram, Facebook, SoundCloud, Bluesky, Dailymotion, LinkedIn,
Pinterest) into a playable file. It is built as infrastructure: one authenticated, rate-limited, cached API in front of
interchangeable providers with automatic failover, and a small app on top for people who just want to paste a link.

| | What | For whom | Docs |
|---|---|---|---|
| [`cli/`](cli) | **`nah`**, the app: a terminal interface you click or type in, plus scriptable commands. Go, one static binary for Linux, macOS and Windows | People who download things | [cli/README.md](cli/README.md) |
| [`api/`](api) | The **API**: Fastify, PostgreSQL, Redis, yt-dlp, ffmpeg. Self-hosted with Docker | Whoever runs the service, and developers integrating it | [api/README.md](api/README.md) |

The two folders are independent: separate dependencies, tests, CI workflows and release tags (`cli/vX.Y.Z` for the app).
They only meet over HTTP.

**Contents:** [Use `nah`](#use-nah) · [Run your own API](#run-your-own-api) · [Not done yet](#not-done-yet) ·
[Repository layout](#repository-layout) · [Contributing](#contributing)

## Use `nah`

`nah` is one program with two faces: a **full-screen interface** (open it by typing `nah`), and **commands** for
scripts. Everything in the interface works with the keyboard *and* the mouse: click the tabs, click a row, use the wheel.

### Install

**From a release** (recommended): open the [Releases page](https://github.com/NICE-DEV226/nice-api-hub/releases), pick the archive for your system
(`nah_<version>_linux_amd64.tar.gz`, `darwin_arm64`, `windows_amd64.zip`…), check it against `SHA256SUMS`, unpack it and put `nah` on
your `PATH`. Releases are built and tested on Linux, macOS and Windows by [GitHub Actions](.github/workflows/release-cli.yml).
No release has been published yet, so for now:

**From source** (needs Go 1.26 or newer; produces one static binary):

```bash
git clone https://github.com/NICE-DEV226/nice-api-hub.git
cd nice-api-hub/cli
make install          # puts `nah` in ~/go/bin (add it to your PATH), or: make build → ./bin/nah
```

### First run

```bash
nah
```

On a computer that has no account, `nah` opens a welcome screen. Pick what fits:

<p align="center"><img src="docs/nah-welcome.png" alt="The welcome screen" width="720"></p>


1. **Create my account**: no e-mail, no password. Your computer is your identity. It takes about a second.
   You are shown a **recovery key once**: copy it or save it to a file. It is the only way back if you lose this computer.
2. **Add this computer to my account**: type the one-time code that `nah link` printed on another computer.
3. **Use my recovery key**: get back in after losing a computer.
4. **I already have an API key**, or 5. **I run this gateway** (paste the admin token).

The gateway address defaults to `http://localhost:3000`; change it from the welcome screen, with `nah init <url>`, or with
`NAH_URL`. Afterwards, typing `nah` opens straight on the download screen: paste a link, `Enter`, click the quality you
want, click again to download. When you start a download, a folder picker asks where to save it (with places, recent folders, filter-as-you-type and path
completion; `Enter` accepts the proposed folder). Files are never overwritten (`clip (2).mp4`).

<p align="center"><img src="docs/nah-home.png" alt="The home screen: paste a link" width="760"></p>

Before you choose anything, you see what you are about to download, in plain words:

<p align="center"><img src="docs/nah-overview.png" alt="The overview: preview image, title, and the choices" width="760"></p>

When the download starts, a picker asks where to save it:

<p align="center"><img src="docs/nah-picker.png" alt="The folder picker" width="640"></p>

### Everyday commands

```bash
nah download <url>            # one playable file (video and audio merged); --mp3, --max-height 720, -o DIR
nah history                   # what this computer downloaded
nah again                     # download the last one again (or: nah again 3)
nah link                      # a code to add another computer to your account
nah keys list                 # your computers and keys; revoke or rotate any of them
```

Full reference, scripting notes, per-platform details and security model: **[cli/README.md](cli/README.md)**.

## Run your own API

Prerequisites: Docker with the **buildx** plugin (on Arch: `sudo pacman -S docker-buildx`), and your user in the `docker` group.

```bash
cd api
cp .env.example .env                   # fill KEY_PEPPER, ADMIN_TOKEN, POSTGRES_PASSWORD (openssl rand -base64 48)
docker compose up -d --build           # postgres, redis, migrate (one-shot), api, worker
curl localhost:3000/readyz             # {"status":"ready", ...}
```

Set `SIGNUP_MODE=open` in `.env` to let people create their own account from `nah` (no e-mail: the computer is the identity).
Everything else (endpoints, configuration, architecture, operations, adding a provider) is in **[api/README.md](api/README.md)**.

## Not done yet

Things this README does **not** promise, so you are not surprised:

- **No release has been published yet.** The pipeline exists and is exercised on every change, but nobody has tagged `cli/v0.1.0`.
  A one-line installer (`install.sh`, `install.ps1`) and `nah update` are planned.
- **The interface has Dashboard, Accounts (operator) and the download screen.** Download history is available as commands
  (`nah history`, `nah again`); History, Devices and Settings *tabs* are not in the interface yet.
- **`nah` was run for real on Linux only.** The macOS and Windows builds compile and their platform code (machine id,
  keychain, file names, opening files) is unit-tested; the CI runs the tests on both systems, but nobody has used the app by hand there.
- **The Dashboard shows every platform as "unknown"** until the API's probes are enabled (`PROBES_ENABLED=true`).
- **YouTube from a datacenter IP** will likely need a proxy or cookies (see [api/README.md](api/README.md#things-to-know-before-running-this-for-real)).

## Repository layout

```
api/                 the API: package.json, Dockerfile, compose.yaml, src/, test/, migrations/
cli/                 the app `nah`: go.mod, cmd/, internal/, Makefile
docs/                screenshots used by the READMEs
.github/workflows/   api.yml · cli.yml (tests on every OS) · release-cli.yml · probe.yml (daily provider check)
```

## Contributing

Bug reports, fixes and new providers are welcome. Read **[CONTRIBUTING.md](CONTRIBUTING.md)** first (setup, tests, conventions,
how a release is made) and follow the **[Code of Conduct](CODE_OF_CONDUCT.md)**.

## Licence

No licence has been chosen for this repository yet, which means that, by default, all rights are reserved. Until one is added,
do not assume you may redistribute it.

## Legal note

Providers call third-party services whose terms may restrict automated use, and downloading content from some
platforms may conflict with their terms or with copyright. Keep the provider layer swappable and review the licensing
of any code you port from the upstream project before commercial use.
