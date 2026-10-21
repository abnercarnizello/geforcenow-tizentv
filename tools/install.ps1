param(
    [Parameter(Mandatory = $true)][string]$TvIp,
    [Parameter(Mandatory = $true)][string]$PackageFile,
    [string]$SdbPath,
    [switch]$Launch
)
$ErrorActionPreference = 'Stop'
$address = $null
if (-not [Net.IPAddress]::TryParse($TvIp, [ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'TvIp must be an IPv4 address.'
}
$packagePath = (Resolve-Path -LiteralPath $PackageFile).Path
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($packagePath)
try {
    foreach ($name in @('config.xml', 'author-signature.xml', 'signature1.xml')) {
        if ($null -eq $archive.GetEntry($name)) { throw "Missing $name. Build with a Samsung signing profile before installation." }
    }
} finally { $archive.Dispose() }
if (-not $SdbPath) {
    $localSdb = Join-Path $PSScriptRoot '..\.tools\sdb\data\tools\sdb.exe'
    if (Test-Path -LiteralPath $localSdb) { $SdbPath = (Resolve-Path -LiteralPath $localSdb).Path }
    else { $SdbPath = 'sdb' }
}
& $SdbPath connect $TvIp
if ($LASTEXITCODE -ne 0) { throw 'TV connection failed. Check Developer Mode and the PC IP.' }
$serial = $TvIp + ':26101'
$installOutput = & $SdbPath -s $serial install $packagePath 2>&1
$exitCode = $LASTEXITCODE
$installOutput | Write-Host
if ($exitCode -ne 0 -or ($installOutput -join "`n") -match '(?i)failed|error|cannot|closed') { throw 'TV rejected installation. Inspect the certificate/DUID and installation log above.' }
if ($Launch) {
    & $SdbPath -s $serial shell 0 execute eTg1POgH1N.BasicProject
    if ($LASTEXITCODE -ne 0) { throw 'Widget installed, but launching failed.' }
}
