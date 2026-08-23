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

if ([string]::IsNullOrWhiteSpace($env:CORE_BASE_URL)) { throw 'CORE_BASE_URL 不能为空' }
$summaryDir = [Environment]::ExpandEnvironmentVariables($env:SUMMARY_DIR)
New-Item -ItemType Directory -Force -Path $summaryDir | Out-Null
$env:BASE_URL = $env:CORE_BASE_URL
$env:SUMMARY_PATH = Join-Path $summaryDir 'core-summary.json'

& k6 run (Join-Path $root 'loadtest\core.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
