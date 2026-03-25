[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$OpenCliArgs
)

$ErrorActionPreference = 'Stop'

$chatwiseExe = 'C:\Program Files\ChatWise\ChatWise.exe'
if (-not (Test-Path $chatwiseExe)) {
  throw "ChatWise executable not found at $chatwiseExe"
}

$opencli = Get-Command opencli -ErrorAction SilentlyContinue
if (-not $opencli) {
  throw 'opencli was not found in PATH'
}

function Clear-LocalProxyEnv {
  $vars = 'http_proxy','https_proxy','HTTP_PROXY','HTTPS_PROXY'
  foreach ($name in $vars) {
    Set-Item -Path "Env:$name" -Value ''
  }
  $noProxy = '127.0.0.1,localhost'
  Set-Item -Path 'Env:NO_PROXY' -Value $noProxy
  Set-Item -Path 'Env:no_proxy' -Value $noProxy
}

function Stop-ChatWiseTree {
  $candidates = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -match '^ChatWise\.exe$|^chatwise\.exe$' }

  foreach ($proc in $candidates) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
    } catch {}
  }

  Start-Sleep -Seconds 2
}

function Wait-ChatWiseDebugPort {
  param(
    [int]$Port = 9228,
    [int]$TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$Port/json/version"
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
        return
      }
    } catch {}
    Start-Sleep -Milliseconds 500
  }

  throw "ChatWise debugging endpoint did not come up on 127.0.0.1:$Port"
}

Clear-LocalProxyEnv
Stop-ChatWiseTree

$proc = Start-Process -FilePath $chatwiseExe -ArgumentList '--remote-debugging-port=9228' -PassThru
Start-Sleep -Seconds 4

if ($proc.HasExited) {
  throw "ChatWise exited early with code $($proc.ExitCode)"
}

Wait-ChatWiseDebugPort

$env:OPENCLI_CDP_ENDPOINT = 'http://127.0.0.1:9228'

if (-not $OpenCliArgs -or $OpenCliArgs.Count -eq 0) {
  & $opencli.Source 'chatwise' 'status'
  exit $LASTEXITCODE
}

& $opencli.Source @OpenCliArgs
exit $LASTEXITCODE
