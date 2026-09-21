# Contributing to NICE-API'HUB

Thanks for taking the time. This project is small and opinionated; this page tells you how to get a change accepted
without a long back and forth. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bug?** Open an issue with what you ran, what you expected, what happened, and your OS and versions
  (`nah version`, `node -v`, `docker --version`). A request id from an error message is gold.
- **Small fix** (typo, obvious bug, missing test)? Just open a pull request.
- **New feature, new provider, or anything that changes behaviour or the API?** Open an issue first and describe the problem
  you want to solve. It saves you from writing something we cannot merge.
- **Security problem?** Do not open a public issue: see [below](#reporting-a-security-problem).

## What lives where

| Path | What | Stack |
|---|---|---|
| `api` | The API and the worker | TypeScript (ESM), Fastify 5, PostgreSQL, Redis, TypeBox |
| `cli` | `nah`, the terminal app and commands | Go 1.26, Cobra, Bubble Tea |
| `.github/workflows` | CI and the daily provider probe | GitHub Actions |

Architecture and design decisions are in [api/README.md](api/README.md); the CLI's layout is in [cli/README.md](cli/README.md#development).

## Setting up

### API (`api/`)

Needs Node 22+, ffmpeg, and PostgreSQL + Redis. Docker is not required for development:

```bash
cd api
npm ci
scripts/dev-services.sh start              # throwaway Postgres + Redis on ports 55432 / 56379
eval "$(scripts/dev-services.sh env)"      # exports the connection variables
npm run typecheck
npm test                                   # integration tests need the services, otherwise they skip
```

`npm test` runs against **real PostgreSQL and Redis**, not mocks, because the interesting behaviour (atomic rate limiting,
cache invalidation, quota sharing across keys) lives there. Do not replace those tests with mocks.

Run the whole stack with Docker instead, from `api/`: `cp .env.example .env`, fill the secrets, `docker compose up -d --build`.

### CLI (`cli/`)

Needs Go 1.26+.

```bash
cd cli
make test          # or: make race   (CI runs the race detector)
make vet
make build && ./bin/nah
```

To try the CLI without touching your real setup, isolate it:

```bash
export NAH_CONFIG_DIR=/tmp/nah-dev/cfg NAH_DATA_DIR=/tmp/nah-dev/data NAH_NO_KEYRING=1
```

The server allows one active account per computer, so testing registration on your own machine uses up its slot. To act as a
second computer, set `NAH_DEVICE_ID=laptop-2` (any text; it replaces the machine identifier).

Tests must never touch your real keychain, clipboard, config or network. Use the fakes that are already in the test files.

## Making a change

1. Branch from `main` (or the current integration branch, `v2/api-core`, while the rewrite is open). Keep one change per branch.
2. Write the test first or with the change. A bug fix comes with a test that fails without it.
3. Run the checks for the part you touched (above). CI runs all of them, plus a Docker build.
4. Open the pull request and fill in *what* changed and *why*. Say what you tested by hand and what you could not.

### Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org): `feat(cli): …`, `fix(gateway): …`,
  `docs: …`, `test: …`, `refactor: …`, `chore: …`. The first line says what changed in the imperative; the body says why.
  Do not add `Co-Authored-By` or tool signatures.
- **Comments** explain *why*, not what the code says. Match the density and naming of the file you edit.
- **Errors** from the API are RFC 9457 `application/problem+json` with a stable `code`. Add a code, never rename one.
- **No secrets in code, fixtures or logs.** Fixtures captured from real services must have cookies and tokens removed.
- **Security-sensitive changes** (keys, scopes, rate limits, registration, SSRF guards) need a test that proves the guard, and
  a sentence in the PR on what an attacker could try.
- **Look of the interface:** flat colours, one accent (`cli/internal/ui/style.go`), colour only for status. No gradients,
  no decoration for its own sake.
- **Cross-platform:** the CLI ships for Linux, macOS and Windows. Anything that touches files, paths, the clipboard, the
  keychain or a machine identifier goes through `internal/{paths,device,vault,clip,opener,dl}`, with a test that fakes the
  other operating systems. Check `GOOS=windows go vet ./...` and `GOOS=darwin go vet ./...`.

### Adding a provider or platform

Follow [Adding a platform or provider](api/README.md#adding-a-platform-or-provider). In short: a host allowlist in
`providers/platforms.ts`, a `Provider` that throws `ProviderError` with the right `kind`, a pure parser unit-tested on a
captured fixture, and a known-good URL in `PROBE_URLS`. Keep a provider only if the real probe passes, and do not add anything
that defeats an anti-bot challenge or a DRM.

## Continuous integration

Every push and pull request runs the workflows of the folder it touches (`.github/workflows/`):

| Workflow | Runs when | What it checks |
|---|---|---|
| `cli.yml` | `cli/**` changes | vet and tests on **Linux (Intel and ARM), macOS and Windows**, gofmt, a real run of the built binary, a compile check of all six release targets, `govulncheck` |
| `api.yml` | `api/**` changes | type check, tests against real Postgres and Redis, build, `npm audit`, Docker image build and smoke test |
| `probe.yml` | every day | each provider against the real upstream service (fails when a site changes) |

Nothing is merged with a red workflow. The workflows only run for the folder that changed, so if you turn on required status
checks in the repository settings, remember GitHub then waits forever for a workflow that was skipped: require them through a
ruleset that allows skipped checks, or add a small always-run "gate" job.

## Releasing the CLI

Releases are made by pushing a tag with the `cli/` prefix (it keeps them apart from the API, and is the form Go expects for a module
that lives in a folder):

```bash
git tag cli/v0.2.0
git push origin cli/v0.2.0
```

`release-cli.yml` then runs the tests, builds Linux, macOS and Windows archives (Intel/AMD and ARM), verifies each against
`SHA256SUMS`, unpacks and runs the ones a runner can execute on their own system, attests where the files came from, and publishes a
GitHub release whose notes are the history of `cli/` since the previous tag. A version with a suffix (`cli/v0.2.0-rc.1`) is published as a
pre-release.

To rehearse without publishing anything: *Actions → Release CLI → Run workflow*. It builds and verifies everything and leaves the
archives as workflow artifacts. Locally, `cd cli && make dist VERSION=0.2.0` builds the same archives into `cli/dist/`.

Versions follow [semantic versioning](https://semver.org): a breaking change to commands, flags, exit codes or the file layout is a
new major version (or a new minor while the app is below 1.0).

## Reporting a security problem

Please **do not** file a public issue for a vulnerability (auth bypass, key or recovery-key exposure, SSRF, quota bypass,
anything that lets one account read or spend another's). Use GitHub's private
[**Report a vulnerability**](https://github.com/NICE-DEV226/nice-api-hub/security/advisories/new) form on this repository's *Security* tab. Include steps to
reproduce and the version or commit. We will acknowledge it, work on a fix privately, and credit you if you wish.

## Licence

No licence has been chosen for this repository yet (see the [README](README.md#licence)). Until one is added, please open an
issue before investing in a large contribution, so we can agree on the terms first.
