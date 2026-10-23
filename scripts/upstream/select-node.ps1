$ErrorActionPreference = 'Stop'
$paperclipRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$paperclipMajor = (Get-Content -LiteralPath (Join-Path $paperclipRoot '.nvmrc') -Raw).Trim()
if (-not $env:PAPERCLIP_NODE_EXECUTABLE) { throw 'Set PAPERCLIP_NODE_EXECUTABLE to an installed runtime for the owning .nvmrc major.' }
$paperclipNode = (Resolve-Path -LiteralPath $env:PAPERCLIP_NODE_EXECUTABLE).Path
$paperclipVersion = & $paperclipNode --version
if ($LASTEXITCODE -ne 0 -or $paperclipVersion -notmatch "^v$([regex]::Escape($paperclipMajor))\.") { throw 'Paperclip Node major does not match .nvmrc' }
$env:PATH = (Split-Path -Parent $paperclipNode) + [IO.Path]::PathSeparator + $env:PATH
if ((Get-Command node).Source -ne $paperclipNode) { throw 'Selected Paperclip Node is not the resolved executable' }
Write-Output "Paperclip selected Node $paperclipVersion ($paperclipNode)."
