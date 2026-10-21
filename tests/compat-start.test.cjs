'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const wrapper = path.join(__dirname, '../tools/compat/start.ps1');
const windows = {skip:process.platform !== 'win32'};
const quote = value => "'" + value.replace(/'/g, "''") + "'";

function runScenario(scenario) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gfn-compat-start-test-'));
  const driver = path.join(temporary, 'driver.ps1');
  fs.writeFileSync(driver, `
    $global:scenario = ${quote(scenario)}
    $global:events = [Collections.Generic.List[object]]::new()
    function global:node {
      $global:LASTEXITCODE = 0
      if ($args[0] -eq '--version') { 'v22.15.0'; return }
      if ($args[0] -like '*session.cjs') {
        $global:events.Add(@{command='session'; endpoint=$env:GFN_CDP_ENDPOINT; duration=$env:GFN_OBSERVE_MS; capture=$env:GFN_CAPTURE_TEXT})
        if ($global:scenario -eq 'session-failure') { $global:LASTEXITCODE = 17 }
      }
    }
    function global:Test-Sdb {
      $global:LASTEXITCODE = 0
      $global:events.Add(@{command='sdb'; arguments=@($args)})
      if ($args -contains '--remove' -and $global:scenario -eq 'cleanup-failure') {
        throw 'simulated SDB cleanup failure'
      }
      elseif ($args -contains '--list') {
        if ($global:scenario -eq 'occupied-forward') { "some-device tcp:$global:localPort tcp:7011" }
      }
      elseif ($args -contains 'debug') {
        if ($global:scenario -eq 'ambiguous-port') { 'port: 7011'; 'port: 7012' }
        elseif ($global:scenario -eq 'debug-failure') { 'failed to launch application' }
        else { 'application launched successfully'; '... port: 7011' }
      }
    }
    $env:GFN_CDP_ENDPOINT = 'original-endpoint'
    $env:GFN_OBSERVE_MS = 'original-duration'
    [Environment]::SetEnvironmentVariable('GFN_CAPTURE_TEXT', $null, 'Process')
    $beforeDirectory = (Get-Location).Path
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $probe.Start()
    $global:localPort = $probe.LocalEndpoint.Port
    $probe.Stop()
    $failure = $null
    try { & ${quote(wrapper)} -TvIp '192.168.15.9' -SdbPath 'Test-Sdb' -LocalPort $global:localPort }
    catch { $failure = $_.Exception.Message }
    $result = @{events=@($global:events.ToArray()); localPort=$global:localPort; failure=$failure; endpoint=$env:GFN_CDP_ENDPOINT; duration=$env:GFN_OBSERVE_MS; capture=$env:GFN_CAPTURE_TEXT; sameDirectory=((Get-Location).Path -eq $beforeDirectory)}
    Write-Output ('RESULT_JSON:' + ($result | ConvertTo-Json -Compress -Depth 8))
  `);
  try {
    // All device, network and dependency actions resolve to the local functions
    // above. The actual wrapper executes its parsing, ownership and finally path.
    const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',driver], {encoding:'utf8',timeout:30000});
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const marker = result.stdout.lastIndexOf('RESULT_JSON:');
    assert.notEqual(marker, -1, result.stdout + result.stderr);
    return JSON.parse(result.stdout.slice(marker + 'RESULT_JSON:'.length).trim());
  } finally {
    fs.rmSync(temporary, {recursive:true,force:true});
  }
}

function sdbCalls(result) { return result.events.filter(event => event.command === 'sdb').map(event => event.arguments.join(' ')); }
function restored(result) {
  assert.equal(result.endpoint, 'original-endpoint');
  assert.equal(result.duration, 'original-duration');
  assert.equal(result.capture, null);
  assert.equal(result.sameDirectory, true);
}

test('launcher sets a persistent private-text-free session and cleans up its own forwarding', windows, () => {
  const result = runScenario('success');
  assert.equal(result.failure, null);
  assert.deepEqual(result.events.find(event => event.command === 'session'), {
    command:'session', endpoint:'http://127.0.0.1:' + result.localPort, duration:'0', capture:'0'
  });
  const calls = sdbCalls(result);
  assert.ok(calls.includes('-s 192.168.15.9:26101 forward tcp:' + result.localPort + ' tcp:7011'));
  assert.equal(calls.at(-1), '-s 192.168.15.9:26101 forward --remove tcp:' + result.localPort);
  restored(result);
});

test('session failure still removes owned forwarding and restores the previous environment', windows, () => {
  const result = runScenario('session-failure');
  assert.match(result.failure, /sessao de compatibilidade/);
  assert.equal(sdbCalls(result).at(-1), '-s 192.168.15.9:26101 forward --remove tcp:' + result.localPort);
  restored(result);
});

test('failure while removing forwarding still restores the environment and working directory', windows, () => {
  const result = runScenario('cleanup-failure');
  assert.equal(result.failure, null);
  assert.equal(sdbCalls(result).at(-1), '-s 192.168.15.9:26101 forward --remove tcp:' + result.localPort);
  restored(result);
});

test('an existing SDB forward is preserved and app startup is refused', windows, () => {
  const result = runScenario('occupied-forward');
  assert.match(result.failure, /ja esta em uso/);
  assert.ok(sdbCalls(result).every(call => !call.includes('debug') && !call.includes('--remove')));
  assert.ok(result.events.every(event => event.command !== 'session'));
  restored(result);
});

test('ambiguous debug output cannot create or remove a forwarding', windows, () => {
  const result = runScenario('ambiguous-port');
  assert.match(result.failure, /unica porta/);
  assert.ok(sdbCalls(result).every(call => !call.includes('forward tcp:') && !call.includes('--remove')));
  restored(result);
});

test('a launch failure is caught even when SDB reports exit code zero', windows, () => {
  const result = runScenario('debug-failure');
  assert.match(result.failure, /failed to launch application/);
  assert.ok(sdbCalls(result).every(call => !call.includes('forward tcp:') && !call.includes('--remove')));
  restored(result);
});
