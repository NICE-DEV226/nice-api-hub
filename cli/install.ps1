<#
.SYNOPSIS
  Installs nah on Windows.

.DESCRIPTION
  Works out your processor, downloads the archive of a release, CHECKS IT against the release's SHA256SUMS (and refuses to
  install on any mismatch), unpacks it and puts nah.exe in a folder of your own. No administrator rights, nothing else touched.
  The copy attached to a release installs exactly that release; the copy in the repository installs the latest one.

    irm https://raw.githubusercontent.com/NICE-DEV226/nice-api-hub/main/cli/install.ps1 | iex

  With a pipe, pass options as environment variables (NAH_VERSION, NAH_PRE, NAH_INSTALL_DIR); saved to a file, use the parameters.
  For mirrors and tests: NAH_DOWNLOAD_BASE (folder that holds nah_<version>_windows_<arch>.zip and SHA256SUMS), NAH_RELEASES_API.
  To uninstall: delete the folder it printed, and remove it from your user PATH.

.PARAMETER Version
  Install this version (default: the latest release).
.PARAMETER Pre
  When picking "the latest", accept pre-releases too.
.PARAMETER Dir
  Where to put nah.exe (default: %LOCALAPPDATA%\Programs\nah).
.PARAMETER NoPathUpdate
  Do not add the folder to your user PATH.
#>
[CmdletBinding()]
param(
  [string]$Version = $env:NAH_VERSION,
  [switch]$Pre,
  [string]$Dir = $env:NAH_INSTALL_DIR,
  [switch]$NoPathUpdate
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest very slow on Windows PowerShell

$Repo = 'NICE-DEV226/nice-api-hub'
# Filled in by the release workflow in the copy attached to a release; left as is in the repository.
$Pinned = '__NAH_PINNED_VERSION__'
$Unpinned = '__NAH_PINNED' + '_VERSION__'

function Fail([string]$Message) { Write-Host "nah install: $Message" -ForegroundColor Red; throw "nah install: $Message" }
function Say([string]$Message) { Write-Host $Message }

# Older Windows PowerShell does not offer TLS 1.2 unless asked.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

if ($env:NAH_PRE) { $Pre = $true }
$Base = $env:NAH_DOWNLOAD_BASE
$Api = $env:NAH_RELEASES_API
if (-not $Api) { $Api = "https://api.github.com/repos/$Repo/releases?per_page=100" }

# --- which system ------------------------------------------------------------------
$arch = $env:PROCESSOR_ARCHITEW6432 # a 32-bit PowerShell on a 64-bit Windows reports the real one here
if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
switch -Regex ($arch) {
  '^(AMD64|x64)$' { $Arch = 'amd64' }
  '^ARM64$'       { $Arch = 'arm64' }
  default         { Fail "unsupported processor: $arch (nah is built for amd64 and arm64)" }
}

# --- which version -----------------------------------------------------------------
if (-not $Version -and $Pinned -ne $Unpinned) { $Version = $Pinned }
if ($Version) { $Version = ($Version -replace '^cli/', '') -replace '^v', '' }

if (-not $Version) {
  Say 'Looking for the latest release...'
  try { $releases = Invoke-RestMethod -UseBasicParsing -Uri $Api -Headers @{ 'User-Agent' = 'nah-install' } }
  catch { Fail "could not reach $Api ($($_.Exception.Message))" }
  $mine = @($releases | Where-Object { $_.tag_name -like 'cli/v*' -and -not $_.draft })
  if ($mine.Count -eq 0) { Fail "no nah release found at $Api" }
  $stable = $mine | Where-Object { -not $_.prerelease } | Select-Object -First 1
  if ($stable -and -not $Pre) { $chosen = $stable }
  else {
    $chosen = $mine[0]
    if ($chosen.prerelease) { Say "No final release yet: installing the pre-release $($chosen.tag_name -replace '^cli/v', '')." }
  }
  $Version = $chosen.tag_name -replace '^cli/v', ''
}
if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { Fail "'$Version' is not a version like 1.2.3 or 1.2.3-rc.1" }

$File = "nah_${Version}_windows_${Arch}.zip"
if (-not $Base) { $Base = "https://github.com/$Repo/releases/download/cli/v$Version" }
$Base = $Base.TrimEnd('/')

# --- download and check ---------------------------------------------------------------
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("nah-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Say "Installing nah $Version for windows/$Arch..."
  try { Invoke-WebRequest -UseBasicParsing -Uri "$Base/$File" -OutFile (Join-Path $Tmp $File) }
  catch { Fail "could not download $Base/$File (is $Version a release for windows/$Arch?)" }
  try { Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS" -OutFile (Join-Path $Tmp 'SHA256SUMS') }
  catch { Fail "could not download $Base/SHA256SUMS" }

  $line = Get-Content (Join-Path $Tmp 'SHA256SUMS') | Where-Object { $_ -match "\s\*?$([regex]::Escape($File))$" } | Select-Object -First 1
  if (-not $line) { Fail "$File is not listed in SHA256SUMS" }
  $want = ($line -split '\s+')[0].ToLowerInvariant()
  $got = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $Tmp $File)).Hash.ToLowerInvariant()
  if ($want -ne $got) { Fail "the download does not match its checksum (expected $want, got $got). Nothing was installed." }
  Say 'Checksum OK.'

  # --- unpack and install -------------------------------------------------------------
  Expand-Archive -Path (Join-Path $Tmp $File) -DestinationPath $Tmp -Force
  $src = Join-Path $Tmp "nah_${Version}_windows_${Arch}\nah.exe"
  if (-not (Test-Path $src)) { Fail 'the archive does not contain nah.exe' }

  if (-not $Dir) { $Dir = Join-Path $env:LOCALAPPDATA 'Programs\nah' }
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $dest = Join-Path $Dir 'nah.exe'
  $old = "$dest.old"
  # A running program cannot be overwritten on Windows, but it can be renamed: move it aside, then put the new one in place.
  if (Test-Path $old) { Remove-Item -Force $old -ErrorAction SilentlyContinue }
  if (Test-Path $dest) {
    try { Move-Item -Force $dest $old } catch { Fail "cannot replace $dest (is nah running? close it and try again)" }
  }
  try { Copy-Item -Force $src $dest }
  catch {
    if (Test-Path $old) { Move-Item -Force $old $dest }
    Fail "could not put nah.exe in $Dir ($($_.Exception.Message))"
  }
  if (Test-Path $old) { Remove-Item -Force $old -ErrorAction SilentlyContinue }
}
finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

Say ''
Say "nah $Version is installed: $dest"
& $dest version
if ($LASTEXITCODE -ne 0) { Fail 'the installed program does not run' }

# --- PATH -----------------------------------------------------------------------------
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @()
if ($userPath) { $parts = $userPath -split ';' | Where-Object { $_ } }
$onPath = $parts | Where-Object { $_.TrimEnd('\') -ieq $Dir.TrimEnd('\') }
if (-not $onPath) {
  if ($NoPathUpdate) {
    Say ''
    Say "$Dir is not on your PATH. Add it in Settings > System > About > Advanced system settings > Environment Variables."
  }
  else {
    [Environment]::SetEnvironmentVariable('Path', (($parts + $Dir) -join ';'), 'User')
    $env:Path = "$env:Path;$Dir" # this window too
    Say ''
    Say "Added $Dir to your user PATH. Open a new terminal for it to take effect everywhere."
  }
}
Say ''
Say 'Run: nah        (later: nah update)'
