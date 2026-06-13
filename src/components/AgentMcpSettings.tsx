import { useEffect, useState } from 'react';

export default function AgentMcpSettings() {
  const [config, setConfig] = useState('');
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  useEffect(() => {
    window.electronAPI?.getMcpConfig?.().then(setConfig).catch(() => {});
  }, []);

  const copyConfig = async () => {
    if (!config) return;
    await navigator.clipboard.writeText(config);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 1800);
  };

  const copyAgentPrompt = async () => {
    const prompt = config
      ? `请帮我在当前项目或全局配置中，添加一个名为 ocrflow 的 MCP server，配置如下。\n\n如果使用的是 .mcp.json 文件，请创建或修改项目根目录的 .mcp.json：\n\n\`\`\`json\n${config}\n\`\`\`\n\n如果使用的是 Claude Desktop，请修改对应的 mcpServers 配置。\n\n配置完成后，确认 parse_documents 工具可用即可。`
      : '请先打开 OCRFlow 设置页，MCP 配置会自动生成。';

    await navigator.clipboard.writeText(prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 1800);
  };

  const isPackaged = config.includes('OCRFlow') || config.includes('ocrflow');

  const btnStyle: React.CSSProperties = { padding: '5px 16px', fontWeight: 600, fontSize: 12 };

  return (
    <div>
      {/* 区域一：MCP 接入 */}
      <div className="sec">
        <div className="sec-title">MCP 接入</div>
        <div className="sec-desc">让 AI Agent 直接调用 OCR 能力，一次配置即可</div>
        <div className="card">
          {/* 方式一：Agent 自动配置 */}
          <div className="row" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12, marginBottom: 2 }}>
            <span className="lbl">
              交给 Agent 自动配置
              <span className="hint">复制下面这段话发给任意 AI Agent，它会帮你完成配置</span>
            </span>
            <div className="ctrl">
              <button className="test-btn success" onClick={copyAgentPrompt} style={btnStyle}>
                {copiedPrompt ? '已复制指令' : '复制配置指令'}
              </button>
            </div>
          </div>

          {/* 方式二：手动配置 */}
          <div className="row" style={{ borderBottom: 'none', flexWrap: 'wrap' }}>
            <span className="lbl">
              自己手动配置
              <span className="hint">将 JSON 粘贴到 MCP 客户端配置文件{
                isPackaged ? '。OCRFlow 自带运行时，无需安装 Node.js' : ''
              }</span>
            </span>
            <div className="ctrl" style={{ width: '100%', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <pre style={{
                fontSize: 11, background: 'var(--glass-2)', padding: '8px 10px',
                borderRadius: 6, margin: 0, overflowX: 'auto',
                color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
                lineHeight: 1.5,
              }}>{config || '正在生成...'}</pre>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button className="test-btn" onClick={copyConfig} style={btnStyle}>
                  {copiedConfig ? '已复制' : '复制 MCP 配置'}
                </button>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  软件移动位置后需重新复制
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 区域二：命令行 */}
      <div className="sec">
        <div className="sec-title">命令行调用（CLI）</div>
        <div className="sec-desc">无需 GUI，通过命令行完成 OCR。Token 等配置复用 GUI 设置</div>
        <div className="card">
          <div className="row">
            <span className="lbl">开发环境</span>
            <div className="ctrl" style={{ flex: 1 }}>
              <code style={{ fontSize: 11, background: 'var(--glass-2)', padding: '3px 8px', borderRadius: 4 }}>
                npm run parse -- "D:\docs\report.pdf" --out "D:\ocr-out" --json
              </code>
            </div>
          </div>
          <div className="row" style={{ borderBottom: 'none' }}>
            <span className="lbl">
              打包后使用
              <span className="hint">支持参数：--out / --provider / --providers / --concurrency / --chunk-size / --json / --help</span>
            </span>
            <div className="ctrl" style={{ flex: 1 }}>
              <code style={{ fontSize: 11, background: 'var(--glass-2)', padding: '3px 8px', borderRadius: 4 }}>
                OCRFlow.exe --headless parse "D:\docs\report.pdf" --out "D:\ocr-out" --json
              </code>
            </div>
          </div>
        </div>
      </div>

      {/* 区域三：工具速查 */}
      <div className="sec">
        <div className="sec-title">MCP 参数速查</div>
        <div className="sec-desc">parse_documents 支持的输入参数</div>
        <div className="card">
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', color: 'var(--text-secondary)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, width: 100 }}>参数</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, width: 60 }}>类型</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '3px 8px' }}><code>paths</code></td>
                <td style={{ padding: '3px 8px' }}>string[]</td>
                <td style={{ padding: '3px 8px' }}>文件/文件夹的绝对路径（必填），建议使用正斜杠</td>
              </tr>
              <tr>
                <td style={{ padding: '3px 8px' }}><code>outputDir</code></td>
                <td style={{ padding: '3px 8px' }}>string</td>
                <td style={{ padding: '3px 8px' }}>输出目录（可选，默认使用 GUI 设置）</td>
              </tr>
              <tr>
                <td style={{ padding: '3px 8px' }}><code>providers</code></td>
                <td style={{ padding: '3px 8px' }}>string[]</td>
                <td style={{ padding: '3px 8px' }}>服务商 fallback 顺序，如 <code>["mineru-cloud", "paddleocr-cloud"]</code></td>
              </tr>
              <tr>
                <td style={{ padding: '3px 8px' }}><code>provider</code></td>
                <td style={{ padding: '3px 8px' }}>string</td>
                <td style={{ padding: '3px 8px' }}>指定单个服务商：<code>auto</code> / <code>mineru-cloud</code> / <code>paddleocr-cloud</code></td>
              </tr>
              <tr>
                <td style={{ padding: '3px 8px' }}><code>concurrency</code></td>
                <td style={{ padding: '3px 8px' }}>number</td>
                <td style={{ padding: '3px 8px' }}>并发数 1-8（可选，默认使用 GUI 设置）</td>
              </tr>
              <tr>
                <td style={{ padding: '3px 8px' }}><code>chunkSize</code></td>
                <td style={{ padding: '3px 8px' }}>number</td>
                <td style={{ padding: '3px 8px' }}>每块页数（可选，默认使用 GUI 设置）</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 区域四：调用示例 */}
      <div className="sec">
        <div className="sec-title">调用示例</div>
        <div className="sec-desc">Agent 调用 parse_documents 时的 JSON 参数（路径请替换为你本机实际路径）</div>
        <div className="card">
          <pre style={{
            fontSize: 11, background: 'var(--glass-2)', padding: '10px 12px',
            borderRadius: 6, margin: 0, overflowX: 'auto', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)', lineHeight: 1.6,
          }}>{`{
  "paths": ["C:/Users/你的用户名/Documents/report.pdf", "C:/Users/你的用户名/Desktop/ocr-input"],
  "outputDir": "C:/Users/你的用户名/Desktop/ocr-output",
  "providers": ["mineru-cloud", "paddleocr-cloud"]
}`}</pre>
        </div>
      </div>
    </div>
  );
}
