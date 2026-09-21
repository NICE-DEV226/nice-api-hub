`nah` downloads media from YouTube, TikTok, X, Instagram, Facebook, SoundCloud, Bluesky, Dailymotion, LinkedIn and Pinterest, from a terminal interface you can click or type in. It talks to a NICE-API'HUB API that you run yourself (see [`api/README.md`](https://github.com/NICE-DEV226/nice-api-hub/blob/main/api/README.md)).

### Highlights

- **Run `nah`.** A first-run screen creates your account with no e-mail and no password: your computer is the identity. You get a recovery key, and a link code to add another computer later.
- **See what you are about to download.** Paste a link and get a preview image, the title, the author and the length, then plain choices: best quality, each available height with its size, audio only, MP3.
- **A folder picker asks where to save each download.** Shortcuts (Downloads, Documents, drives), recent folders, type to filter, typed paths with completion, new folder. Mouse and keyboard everywhere.
- **Scriptable.** `nah download`, `nah history`, `nah again`, `nah keys`, `nah link`, `nah admin …`, with `--json` and meaningful exit codes.
- **One-line install, one-line update.** `install.sh` (Linux, macOS) and `install.ps1` (Windows) check the download against `SHA256SUMS` before installing anything, and `nah update` does the same to replace itself.
- **Secrets stay safe.** Keys go to the system keychain (Keychain, Credential Manager, Secret Service); the recovery key is never stored unless you save it yourself.

### Known limits

- Windows and macOS builds are tested by the CI on every change, but nobody has used the app by hand there yet. Reports are welcome.
- Without a version, the installers and `nah update` pick the newest final release and ignore pre-releases unless you pass `--pre` (or `-Pre`).
- It needs an API to talk to; the address defaults to `http://localhost:3000`.
