---
name: mcp-server-test
description: Build and test the MCP server end-to-end: compile, spawn, invoke tools, verify responses
---

# MCP Server Test Harness

Systematically build, spawn, and test the MCP server. Use this after any change to MCP-related code or when verifying the server works in both dev and packaged modes.

## Procedure

### 1. Compile

```bash
npx tsc --noEmit -p tsconfig.json
```

Fix any errors before proceeding. Then build:

```bash
npx vite build
```

### 2. Test dev-mode MCP

Spawn the server and run a tool call:

```bash
node - <<'NODE'
const { spawn } = require('child_process');
const child = spawn('node', ['dist-electron/mcp-server.js'], { stdio: ['pipe','pipe','pipe'] });
let out = '', err = '';
child.stdout.on('data', d => out += d);
child.stderr.on('data', d => err += d);

// Send MCP initialize + tools/list
const init = JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1.0'}}});
const listTools = JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});

child.stdin.write('Content-Length: ' + Buffer.byteLength(init) + '\r\n\r\n' + init);
setTimeout(() => {
  child.stdin.write('Content-Length: ' + Buffer.byteLength(listTools) + '\r\n\r\n' + listTools);
}, 500);
setTimeout(() => { console.log('STDOUT:', out); console.log('STDERR:', err); child.kill(); process.exit(0); }, 3000);
NODE
```

### 3. Test a tool call

After confirming tools/list works, invoke `parse_documents` with a test file:

```bash
node - <<'NODE'
const { spawn } = require('child_process');
const child = spawn('node', ['dist-electron/mcp-server.js'], { stdio: ['pipe','pipe','pipe'] });
let out = '', err = '';
child.stdout.on('data', d => out += d);
child.stderr.on('data', d => err += d);

const call = JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'parse_documents',arguments:{files:['D:/path/to/test.pdf'],outputFormat:'markdown'}}});
child.stdin.write('Content-Length: ' + Buffer.byteLength(call) + '\r\n\r\n' + call);
setTimeout(() => { console.log('STDOUT:', out); console.log('STDERR:', err); child.kill(); process.exit(0); }, 10000);
NODE
```

### 4. Test packaged-mode MCP (after electron-builder)

```bash
node - <<'NODE'
const { spawn } = require('child_process');
const mcp = 'D:/Files/projects/docflow/release/win-unpacked/resources/app.asar.unpacked/dist-electron/mcp-server.js';
const child = spawn('node', [mcp], { stdio: ['pipe','pipe','pipe'] });
// ... same test sequence as above
NODE
```

### 5. Test with Claude Desktop config

Verify the MCP config JSON works by reading the generated config and checking structure:

```bash
node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync(process.env.APPDATA+'/Claude/claude_desktop_config.json','utf8')); console.log(JSON.stringify(cfg.mcpServers,null,2));"
```

## Stopping Condition

- Server spawns without error (exit code 0 or stays alive)
- `tools/list` returns the expected tool list
- `parse_documents` returns a valid result for at least one test file
- Packaged-mode MCP responds identically to dev-mode

## Common Failures

- **Port in use**: kill leftover node processes: `taskkill /F /IM node.exe`
- **ENOENT on asar path**: rebuild with `npx electron-builder --win --dir`
- **Module not found**: ensure `npm install` was run and `tsc` compiled successfully
