// Local deterministic test fixture; never contacts Signal or sends real messages.
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2); const dir = args[args.indexOf('--config') + 1]; const endpoint = args[args.indexOf('--http') + 1];
const accountFile = path.join(dir, 'test-account.json'); const account = '+1999' + path.basename(dir).replace(/\D/g, '').padEnd(5, '0');
const streams = new Set();
fs.writeFileSync(path.join(dir, 'test-pid'), String(process.pid));
const server = http.createServer(async (req, res) => {
  if (req.url === '/api/v1/check') { res.end('OK'); return; }
  if (req.url === '/api/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(':ready\n\n'); streams.add(res); req.on('close', () => streams.delete(res)); return; }
  let body = ''; for await (const chunk of req) body += chunk;
  const input = JSON.parse(body); let result;
  switch (input.method) {
    case 'listAccounts': result = fs.existsSync(accountFile) ? [account] : []; break;
    case 'startLink': result = { deviceLinkUri: 'sgnl://linkdevice?uuid=test&pub_key=test' }; break;
    case 'finishLink': await new Promise(r => setTimeout(r, 150)); fs.writeFileSync(accountFile, account); result = {}; break;
    case 'listContacts': result = [{ number: '+100', name: 'Contact' }]; break;
    case 'listGroups': result = []; break;
    case 'sendSyncRequest': result = {}; break;
    case 'send':
      if (input.params.account !== account) { res.end(JSON.stringify({ error: { message: 'wrong account' } })); return; }
      result = { timestamp: Date.now() };
      for (const stream of streams) stream.write('data: ' + JSON.stringify({ params: { account, envelope: { sourceNumber: '+100', sourceName: 'Contact', timestamp: result.timestamp, dataMessage: { timestamp: result.timestamp, message: 'incoming for ' + account } } } }) + '\n\n');
      break;
    default: res.end(JSON.stringify({ error: { message: 'unknown' } })); return;
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
});
server.listen(Number(endpoint.split(':').pop()), '127.0.0.1');
process.on('SIGTERM', () => { for (const stream of streams) stream.end(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 100).unref(); });
