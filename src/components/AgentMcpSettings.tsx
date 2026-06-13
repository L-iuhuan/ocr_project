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

  return (
    <div>
      {/* 区域一：两个行动按钮 */}
      <div className="sec">
        <div className="sec-title">MCP 接入</div>
        <div className="sec-desc">让 AI Agent 直接调用 OCR 能力，一次配置即可</div>
        <div className="mcp-action-area" style={{
          display: 'flex', flexDirection: 'column', gap: 12,
          background: 'var(--glass-1)', borderRadius: 10,
          border: '1px solid var(--border-glass)', padding: 16, marginBottom: 10,
        }}>
          {/* 方式一 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 11, flexShrink: 0,
              background: 'var(--accent-soft)', color: 'var(--accent-text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, marginTop: 2,
            }}>1</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                {isPackaged ? '复制 Prompt，交给 Agent 自动配置' : '交给 Agent 自动配置（推荐）'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                将下面这段话发给任意 AI Agent（Claude / ChatGPT / Cursor 等），它会自动帮你完成 MCP 配置。
              </div>
              <button className="test-btn success" onClick={copyAgentPrompt}
                style={{ fontWeight: 600, padding: '5px 16px' }}>
                {copiedPrompt ? '已复制 Prompt' : '复制配置指令'}
              </button>
            </div>
          </div>

          {/* 分隔 */}
          <div style={{ height: 1, background: 'var(--border-subtle)' }} />

          {/* 方式二 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 11, flexShrink: 0,
              background: 'var(--glass-2)', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, marginTop: 2,
            }}>2</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                自己手动配置
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                复制下面的 JSON，粘贴到对应 MCP 客户端的配置文件中。
                {isPackaged && ' 本配置使用 OCRFlow 自带运行时，无需安装 Node.js。'}
              </div>
              <pre style={{
                fontSize: 11, background: 'var(--glass-2)', padding: '8px 10px',
                borderRadius: 6, margin: '0 0 6px 0', overflowX: 'auto',
                color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
                maxHeight: 160, overflowY: 'auto', lineHeight: 1.5,
              }}>{config || '正在生成...'}</pre>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button className="test-btn" onClick={copyConfig}
                  style={{ padding: '5px 16px' }}>
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

      {/* 区域二：工具速查 */}
      <div className="sec">
        <div className="sec-title">parse_documents 参数速查</div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', color: 'var(--text-secondary)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600 }}>参数</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600 }}>类型</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600 }}>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '2px 6px' }}><code>paths</code></td>
                <td style={{ padding: '2px 6px' }}>string[]</td>
                <td style={{ padding: '2px 6px' }}>文件/文件夹的绝对路径（必填）</td>
              </tr>
              <tr>
                <td style={{ padding: '2px 6px' }}><code>outputDir</code></td>
                <td style={{ padding: '2px 6px' }}>string</td>
                <td style={{ padding: '2px 6px' }}>输出目录（可选，默认使用 GUI 设置）</td>
              </tr>
              <tr>
                <td style={{ padding: '2px 6px' }}><code>providers</code></td>
                <td style={{ padding: '2px 6px' }}>string[]</td>
                <td style={{ padding: '2px 6px' }}>服务商顺序，如 <code>["mineru-cloud", "paddleocr-cloud"]</code></td>
              </tr>
              <tr>
                <td style={{ padding: '2px 6px' }}><code>provider</code></td>
                <td style={{ padding: '2px 6px' }}>enum</td>
                <td style={{ padding: '2px 6px' }}>指定单个服务商：<code>auto</code> / <code>mineru-cloud</code> / <code>paddleocr-cloud</code></td>
              </tr>
              <tr>
                <td style={{ padding: '2px 6px' }}><code>concurrency</code></td>
                <td style={{ padding: '2px 6px' }}>number</td>
                <td style={{ padding: '2px 6px' }}>并发数 1-8（可选）</td>
              </tr>
              <tr>
                <td style={{ padding: '2px 6px' }}><code>chunkSize</code></td>
                <td style={{ padding: '2px 6px' }}>number</td>
                <td style={{ padding: '2px 6px' }}>每块页数（可选）</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 区域三：示例 */}
      <div className="sec">
        <div className="sec-title">调用示例</div>
        <div className="sec-desc">Agent 调用时的 JSON 参数（路径请替换为你本机的实际路径）</div>
        <div className="card" style={{ padding: '12px 14px' }}>
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
