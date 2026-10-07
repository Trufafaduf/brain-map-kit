# Install the built plugin into a vault by junctioning dist/ into its plugins folder.
#   npm run build
#   powershell -ExecutionPolicy Bypass -File scripts/link-plugin.ps1 -Vault "<path to vault>"
# Then enable "Brain map" under Settings > Community plugins.
# Idempotent: a correct junction is left alone; a real folder in the way stops
# the script rather than being deleted. Junctions need no special privilege.
param([Parameter(Mandatory = $true)][string]$Vault)

$ErrorActionPreference = "Stop"
$kit  = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $kit "dist"
if (-not (Test-Path (Join-Path $dist "main.js"))) { throw "dist/main.js missing. Run: npm run build" }
if (-not (Test-Path (Join-Path $Vault ".obsidian"))) { throw "$Vault has no .obsidian folder; is it a vault?" }

$plugins = Join-Path $Vault ".obsidian\plugins"
New-Item -ItemType Directory -Force $plugins | Out-Null
$link = Join-Path $plugins "brain-map"
if (Test-Path $link) {
    $item = Get-Item $link -Force
    if ($item.LinkType -eq "Junction" -and ($item.Target -contains $dist)) { "ok      $link"; exit 0 }
    if ($item.LinkType -eq "Junction") { $item.Delete() }
    else { throw "$link exists and is not a junction; move it aside first." }
}
cmd /c "mklink /J `"$link`" `"$dist`"" | Out-Null
"linked  $link -> $dist"
