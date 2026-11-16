# Existing Windows installations only; no dependency installation or file overwrite.
param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$CutPilotRepo,
  [ValidateSet('speech','visual')][string]$Mode='visual',
  [switch]$ApplyAndRender,
  [string]$Python=''
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$sourcePath=(Resolve-Path -LiteralPath $Source -ErrorAction Stop).Path
$cutpilotPath=(Resolve-Path -LiteralPath $CutPilotRepo -ErrorAction Stop).Path
$ranker=Join-Path $cutpilotPath 'cutpilot\rank_only.py'
if(!(Test-Path -LiteralPath $ranker)){throw "Rank-only branch not checked out: $ranker"}
$nodeCommand=Get-Command node -ErrorAction Stop
$pythonExe=if($Python){$Python}else{Join-Path $cutpilotPath '.venv\Scripts\python.exe'}
if(!(Test-Path -LiteralPath $pythonExe)){throw "Select existing Python 3.11 environment with -Python: $pythonExe"}
$health=Invoke-RestMethod -Uri 'http://127.0.0.1:32146/api/health' -TimeoutSec 8
if($health.ok -ne $true -or $health.service -ne 'AI Edit Studio' -or $health.schemaVersion -lt 2){throw 'AI Edit Studio 0.12 localhost service not ready. Start Studio first.'}
$evidence=Join-Path $env:TEMP ('cutpilot-retirement-uat-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $evidence -ErrorAction Stop | Out-Null
$manifest=Join-Path $evidence 'frontend_manifest.json'
Push-Location $cutpilotPath
try {
  & $pythonExe -m cutpilot.rank_only --source $sourcePath --output $manifest --mode $Mode
  if($LASTEXITCODE -ne 0){throw "Rank-only stage failed: $LASTEXITCODE"}
}finally{Pop-Location}
$cli=Join-Path $PSScriptRoot 'retirement-uat.mjs'
$cliArgs=@($cli,'--manifest',$manifest,'--source',$sourcePath,'--create-preview-project')
if($ApplyAndRender){$cliArgs+=@('--apply-new-project','--render-vertical')}
$result=Join-Path $evidence 'studio-result.json'
& $nodeCommand.Source @cliArgs | Tee-Object -FilePath $result
if($LASTEXITCODE -ne 0){throw "Studio UAT failed; inspect isolated draft project and evidence: $evidence"}
Write-Host "EVIDENCE_DIR: $evidence"
Write-Host 'Old CutPilot editor was not invoked. Compare the new output with the previously validated CutPilot R10 sample before retirement.'
