param(
    [string]$SignatureProfile,
    [string]$TizenPath = 'tizen'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
[xml]$config = Get-Content -LiteralPath (Join-Path $projectRoot 'config.xml') -Raw
$version = $config.DocumentElement.GetAttribute('version')
$outputDirectory = Join-Path $projectRoot 'dist'
$stage = Join-Path $projectRoot ('.build\' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage, $outputDirectory -Force | Out-Null
# Explicit inventory keeps APKs, evidence, credentials and development tools out of the widget.
$files = @('config.xml', 'index.html', 'icon.png', 'css/style.css', 'js/main.js', 'js/diagnostics.js')
foreach ($file in $files) {
    $source = Join-Path $projectRoot $file
    $target = Join-Path $stage $file
    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if ($SignatureProfile) {
    & $TizenPath package -t wgt -s $SignatureProfile -- $stage
    if ($LASTEXITCODE -ne 0) { throw 'Tizen failed to sign the widget.' }
    $signed = @(Get-ChildItem -LiteralPath $stage -Filter '*.wgt')
    if ($signed.Count -ne 1) { throw 'Expected exactly one signed widget from Tizen CLI.' }
    $archive = [IO.Compression.ZipFile]::OpenRead($signed[0].FullName)
    try {
        foreach ($name in @('author-signature.xml', 'signature1.xml')) {
            if ($null -eq $archive.GetEntry($name)) { throw "Missing widget signature: $name" }
        }
    } finally { $archive.Dispose() }
    $output = Join-Path $outputDirectory "geforcenow-t5300-$version.wgt"
    Copy-Item -LiteralPath $signed[0].FullName -Destination $output -Force
} else {
    $output = Join-Path $outputDirectory "geforcenow-t5300-$version-unsigned.wgt"
    $stream = [IO.File]::Open($output, [IO.FileMode]::Create)
    $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $stage $file), $file, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose(); $stream.Dispose() }
    Write-Host 'Unsigned widget: a Samsung certificate/profile is required before TV installation.'
}
$hasher = [Security.Cryptography.SHA256]::Create()
$hashStream = [IO.File]::OpenRead($output)
try { $hash = ([BitConverter]::ToString($hasher.ComputeHash($hashStream))).Replace('-', '').ToLowerInvariant() }
finally { $hashStream.Dispose(); $hasher.Dispose() }
[IO.File]::WriteAllText("$output.sha256", "$hash  $([IO.Path]::GetFileName($output))`n")
Write-Host $output
Write-Host "SHA256 $hash"
