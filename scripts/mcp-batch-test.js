const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/17986/WorkBuddy/2026-06-16-20-42-40/巨潮公告PDF';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf')).map(f => path.join(dir, f).replace(/\\/g, '/'));
console.log('Parsing %d files ...\n', files.length);

const child = spawn('node', [path.join(__dirname, '..', 'dist-electron', 'mcp-server.js')], { stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '';
child.stdout.on('data', d => {
  buf += d.toString();
  // Parse complete JSON-RPC lines as they arrive
  while (true) {
    const nl = buf.indexOf('\n');
    if (nl < 0) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      // logging notifications come via stdout
      if (msg.method === 'notifications/logging') {
        const p = msg.params;
        const prefix = p.level === 'error' ? '❌' : p.level === 'warning' ? '⚠️' : '  ';
        console.log('%s %s', prefix, p.data);
      }
      // final result
      else if (msg.id === 2 && msg.result) {
        const s = JSON.parse(msg.result.content[0].text);
        console.log('\n=== DONE === ok=%s completed=%d failed=%d', s.ok, s.completed, s.failed);
      }
    } catch (e) {
      // skip partial lines
    }
  }
});

function send(obj) { child.stdin.write(JSON.stringify(obj) + '\n'); }

setTimeout(() => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'batch', version: '0' } } }), 200);
setTimeout(() => send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }), 500);
setTimeout(() => send({
  jsonrpc: '2.0', id: 2, method: 'tools/call',
  params: {
    name: 'parse_documents',
    arguments: {
      paths: files.slice(0, 4),
      outputDir: 'C:/Users/17986/WorkBuddy/2026-06-16-20-42-40/OCR-MCP-progress',
      providers: ['mineru-cloud', 'paddleocr-cloud']
    }
  }
}), 800);

setTimeout(() => { child.kill(); console.log('\nBatch finished.'); process.exit(0); }, 600000);
