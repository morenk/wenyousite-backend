$ErrorActionPreference = 'Stop'

function Import-EnvFile([string] $Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "找不到配置文件：$Path；请先复制 runner.env.example 为 runner.env"
  }
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) { continue }
    $parts = $trimmed -split '=', 2
    if ($parts.Count -ne 2) { throw "配置行格式错误：$line" }
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process')
  }
}

$root = Split-Path -Parent $PSScriptRoot
Import-EnvFile (Join-Path $root 'loadtest\runner.env')

# k6 resolves open() relative to the process working directory. The runner is
# invoked from the repository root, so make fixture paths unambiguous even
# when the script itself is launched from another directory.
$env:MEDIA_SMALL_FILE = Join-Path $root 'loadtest\fixtures\small.png'
$env:MEDIA_MEDIUM_FILE = Join-Path $root 'loadtest\fixtures\medium.png'
$env:MEDIA_LARGE_FILE = Join-Path $root 'loadtest\fixtures\large.png'

if ([string]::IsNullOrWhiteSpace($env:BASE_URL)) { throw 'BASE_URL 不能为空' }
$tokenPath = [Environment]::ExpandEnvironmentVariables($env:AUTH_TOKENS_JSON_PATH)
if (-not (Test-Path -LiteralPath $tokenPath)) { throw "找不到专用账号 Token 文件：$tokenPath" }
$env:AUTH_TOKENS = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
if ([string]::IsNullOrWhiteSpace($env:AUTH_TOKENS)) { throw 'AUTH_TOKENS 文件不能为空' }

$summaryDir = [Environment]::ExpandEnvironmentVariables($env:SUMMARY_DIR)
New-Item -ItemType Directory -Force -Path $summaryDir | Out-Null
$env:SUMMARY_PATH = Join-Path $summaryDir 'media-summary.json'

& k6 run (Join-Path $root 'loadtest\media.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
