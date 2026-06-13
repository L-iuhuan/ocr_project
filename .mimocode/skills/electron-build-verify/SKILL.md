---
name: electron-build-verify
description: Full Electron build, packaging, and verification for OCRFlow (win-unpacked or NSIS installer)
---

# Electron Build & Verify

Complete build pipeline for OCRFlow: TypeScript compile, Vite bundle, electron-builder packaging, and post-build verification.

## Procedure

### 1. Pre-flight checks

```bash
npx tsc --noEmit -p tsconfig.json
```

Fix all errors. Then:

```bash
npx vite build
```

### 2. Full build (win-unpacked only, fastest iteration)

```bash
export PATH="$PWD/node_modules/7zip-bin/win/x64:$PATH"
export DEBUG=electron-builder
rm -rf release
npx tsc 2>&1 >/dev/null; npx vite build 2>&1 >/dev/null
npx electron-builder --win --dir 2>&1
```

### 3. Full build (NSIS installer)

```bash
export PATH="$PWD/node_modules/7zip-bin/win/x64:$PATH"
export DEBUG=electron-builder
rm -rf release
npx tsc 2>&1 >/dev/null; npx vite build 2>&1 >/dev/null
npx electron-builder --win 2>&1
```

### 4. Verify build output

```bash
python -c "
import os, hashlib
exe = 'release/win-unpacked/OCRFlow.exe'
base = 'node_modules/electron/dist/electron.exe'
h1 = hashlib.sha256(open(exe,'rb').read()).hexdigest()[:16]
h2 = hashlib.sha256(open(base,'rb').read()).hexdigest()[:16]
print(f'OCRFlow:  {h1}  size={os.path.getsize(exe):,}')
print(f'Electron: {h2}  size={os.path.getsize(base):,}')
print('Different binary:', h1 != h2)
"
```

### 5. Verify MCP server in packaged build

```bash
node - <<'NODE'
const { spawn } = require('child_process');
const mcp = 'D:/Files/projects/docflow/release/win-unpacked/resources/app.asar.unpacked/dist-electron/mcp-server.js';
const child = spawn('node', [mcp], { stdio: ['pipe','pipe','pipe'] });
let out='', err='';
child.stdout.on('data', d => out += d);
child.stderr.on('data', d => err += d);
const init = JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1.0'}}});
child.stdin.write('Content-Length: '+Buffer.byteLength(init)+'\r\n\r\n'+init);
setTimeout(() => { console.log('STDOUT:', out); console.log('STDERR:', err); child.kill(); process.exit(0); }, 3000);
NODE
```

### 6. Clean build artifacts if needed

```powershell
rm -rf release
rm -rf "$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
```

## Stopping Condition

- `release/win-unpacked/OCRFlow.exe` exists and runs
- OCRFlow.exe has different hash from base electron.exe (app code was injected)
- MCP server responds to initialize in packaged mode
- No build errors in tsc or vite output

## Notes

- `--dir` flag produces unpacked folder only (fast, no installer). Use for rapid iteration.
- Full NSIS installer (`--win` without `--dir`) is slower and produces `release/OCRFlow Setup X.Y.Z.exe`.
- `builder-debug.yml` and `latest.yml` in release/ are build metadata, not needed for distribution.
- The `signAndEditExecutable: false` setting in package.json is required for unsigned builds.
