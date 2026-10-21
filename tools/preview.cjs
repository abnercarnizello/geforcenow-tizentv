'use strict';
// LAN capability preview only; the signed widget remains necessary for Tizen APIs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const host = process.argv[2] || '127.0.0.1';
const tvIp = process.argv[3] || '127.0.0.1';
const port = Number(process.argv[4] || 8765);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/css/style.css', ['css/style.css', 'text/css; charset=utf-8']],
  ['/js/main.js', ['js/main.js', 'application/javascript; charset=utf-8']],
  ['/js/diagnostics.js', ['js/diagnostics.js', 'application/javascript; charset=utf-8']]
]);
const server = http.createServer((req, res) => {
  const remote = req.socket.remoteAddress.replace(/^::ffff:/, '');
  if (![host, tvIp, '127.0.0.1', '::1'].includes(remote)) { res.writeHead(403).end(); return; }
  const url = new URL(req.url, 'http://preview.local');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST' && url.pathname === '/api/report') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) { req.destroy(); }
    });
    req.on('end', () => {
      try {
        const report = JSON.parse(body);
        if (report.modelTarget !== 'UN43T5300AGXZD' || !report.device || !report.webRtc) { throw new Error('Invalid report'); }
        const output = path.join(root, 'dist', 'tv-browser-report.json');
        fs.mkdirSync(path.dirname(output), {recursive: true});
        fs.writeFileSync(output, JSON.stringify({receivedAt: new Date().toISOString(), context: 'LAN HTTP browser preview, not installed widget', report}, null, 2));
        console.log('TV capability report saved: ' + output);
        res.writeHead(204).end();
      } catch { res.writeHead(400).end(); }
    });
    return;
  }
  const asset = assets.get(url.pathname);
  if (req.method !== 'GET' || !asset) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'Content-Type': asset[1]});
  fs.createReadStream(path.join(root, asset[0])).pipe(res);
});
server.listen(port, host, () => console.log('TV preview: http://' + host + ':' + port + '/?report=1'));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
