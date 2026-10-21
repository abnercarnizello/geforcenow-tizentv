param(
    [string]$TvIp,
    [string]$SdbPath,
    [ValidateRange(1, 65535)][int]$LocalPort = 19222
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if (-not $TvIp) { $TvIp = Read-Host 'IP local da TV' }
$address = $null
if (-not [Net.IPAddress]::TryParse($TvIp, [ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'Informe um endereco IPv4 valido para a TV.'
}
$TvIp = $address.ToString()

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Instale Node.js 22 ou mais recente antes de iniciar.' }
$nodeVersion = (& node --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) {
    throw 'Este teste precisa de Node.js 22 ou mais recente.'
}
'if (typeof WebSocket !== "function" || typeof fetch !== "function") process.exit(1);' | & node -
if ($LASTEXITCODE -ne 0) { throw 'O Node.js precisa disponibilizar WebSocket e fetch globais.' }

if (-not $SdbPath) {
    $candidates = @(
        (Join-Path $projectRoot '.tools\sdb\data\tools\sdb.exe'),
        (Join-Path $env:SystemDrive 'tizen-studio\tools\sdb.exe'),
        (Join-Path $env:USERPROFILE 'tizen-studio\tools\sdb.exe')
    )
    $SdbPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $SdbPath) { $SdbPath = 'sdb' }
}
$sdbCommand = Get-Command $SdbPath -ErrorAction SilentlyContinue
if (-not $sdbCommand) { throw 'SDB nao encontrado. Informe -SdbPath com o caminho do sdb.exe do Tizen Studio.' }
if ($sdbCommand.Path) { $SdbPath = $sdbCommand.Path }
else { $SdbPath = $sdbCommand.Name }

function Invoke-SdbChecked {
    param([string[]]$Arguments)
    $output = & $SdbPath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $message = ($output | Out-String).Trim()
    if ($exitCode -ne 0 -or $message -match '(?im)\b(error|failed|cannot|denied|offline|disconnected|closed)\b|not found') {
        throw "A TV nao concluiu a operacao: $message"
    }
    return $message
}

$previousDirectory = Get-Location
$environmentNames = @('GFN_CDP_ENDPOINT', 'GFN_OBSERVE_MS', 'GFN_CAPTURE_TEXT')
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$ownedForward = $false
$serial = $TvIp + ':26101'
try {
    Set-Location -LiteralPath $projectRoot
    $dependenciesRoot = Join-Path $projectRoot '.tools\compat-deps'
    $dependencyCheck = 'const p=require("path");const root=process.argv[2];const deps={esbuild:"0.28.2","core-js-bundle":"3.51.0","@juggle/resize-observer":"3.4.0"};try{for(const [name,version]of Object.entries(deps)){if(require(p.join(root,"node_modules",name,"package.json")).version!==version)process.exit(1);}require(p.join(root,"node_modules","esbuild"));require("fs").accessSync(p.join(root,"node_modules/@juggle/resize-observer/lib/exports/resize-observer.umd.js"));}catch{process.exit(1);}'
    $dependencyCheck | & node - $dependenciesRoot
    if ($LASTEXITCODE -ne 0) {
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm nao encontrado junto com Node.js.' }
        Write-Host 'Preparando os componentes locais de compatibilidade...'
        & npm install --prefix $dependenciesRoot --no-save --package-lock=false --no-audit --no-fund esbuild@0.28.2 core-js-bundle@3.51.0 '@juggle/resize-observer@3.4.0'
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar os componentes locais.' }
        $dependencyCheck | & node - $dependenciesRoot
        if ($LASTEXITCODE -ne 0) { throw 'Os componentes instalados nao passaram na verificacao.' }
    }

    Write-Host 'Conectando a TV. Deixe o computador ligado e esta janela aberta durante o teste.'
    $null = Invoke-SdbChecked -Arguments @('connect', $TvIp)
    $forwards = Invoke-SdbChecked -Arguments @('forward', '--list')
    if ($forwards -match ('(?m)\btcp:' + $LocalPort + '\b')) { throw "A porta $LocalPort ja esta em uso por outra conexao SDB. Encerre o teste anterior primeiro." }
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $LocalPort)
    try { $listener.Start() }
    catch { throw "A porta local $LocalPort ja esta em uso. Encerre o teste anterior primeiro." }
    finally { $listener.Stop() }

    # The debug launch hangs when the app is already open, so close it first.
    # "already Terminated" is the normal answer when it was not running.
    & $SdbPath -s $serial shell 0 kill eTg1POgH1N 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    $debugOutput = Invoke-SdbChecked -Arguments @('-s', $serial, 'shell', '0', 'debug', 'eTg1POgH1N.BasicProject')
    $ports = @([regex]::Matches($debugOutput, '(?im)\bport\s*[:=]\s*(\d{1,5})\b') | ForEach-Object { [int]$_.Groups[1].Value } | Select-Object -Unique)
    if ($ports.Count -ne 1 -or $ports[0] -lt 1 -or $ports[0] -gt 65535) {
        throw "A TV nao informou uma unica porta de depuracao valida: $debugOutput"
    }
    $null = Invoke-SdbChecked -Arguments @('-s', $serial, 'forward', ('tcp:' + $LocalPort), ('tcp:' + $ports[0]))
    $ownedForward = $true
    $env:GFN_CDP_ENDPOINT = ('http://127.0.0.1:' + $LocalPort)
    $env:GFN_OBSERVE_MS = '0'
    $env:GFN_CAPTURE_TEXT = '0'
    Write-Host 'Compatibilidade ativa. Use a TV normalmente. Para encerrar, pressione Ctrl+C nesta janela.'
    & node (Join-Path $PSScriptRoot 'session.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'A sessao de compatibilidade foi interrompida por um erro. Veja a mensagem acima.' }
} finally {
    if ($ownedForward) {
        try {
            & $SdbPath -s $serial forward --remove ('tcp:' + $LocalPort) 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { Write-Warning "Nao foi possivel fechar a conexao local SDB na porta $LocalPort." }
        } catch { Write-Warning "Nao foi possivel fechar a conexao local SDB na porta $LocalPort." }
    }
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
    Set-Location -LiteralPath $previousDirectory.Path
}
