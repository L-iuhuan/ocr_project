import { useEffect, useState } from 'react';

export default function AgentMcpSettings() {
  const [config, setConfig] = useState('');
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  useEffect(() => {
    window.electronAPI?.getMcpConfig?.().then(setConfig).catch(() => {});
  }, []);

  const appVersion = (() => {
    try { const m = config.match(/"version":\s*"([^"]+)"/); if (m) return m[1]; } catch {}
    return '';
  })();

  const isPackaged = config.includes('OCRFlow') || config.includes('ocrflow');

  const buildAgentPrompt = () => {
    if (!config) return '正在生成...';
    return [
      '请帮我添加一个 MCP server，配置如下。',
      '',
      '根据你使用的工具选择对应方式：',
      '• 项目级配置（.mcp.json）：在项目根目录创建或修改 .mcp.json，加入 mcpServers.ocrflow',
      '• Claude Code / Claude Desktop：修改对应的 settings 或 mcp.json',
      '• Cursor：修改 .cursor/mcp.json',
      '• OpenCode / WorkBuddy / QCode 等：参考文档添加 stdio 类型 MCP server',
      '',
      '```json',
      config,
      '```',
      '',
      '添加后请帮我验证 parse_documents 工具是否可用。',
      '工具用途：传入文件/文件夹路径，调用 OCRFlow 批量 OCR 解析并保存 Markdown。',
      `OCRFlow 版本：${appVersion || '见上方配置'}`,
    ].join('\n');
  };

  const promptText = buildAgentPrompt();

  const copyConfig = async () => {
    if (!config) return;
    await navigator.clipboard.writeText(config);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 1800);
  };

  const copyAgentPrompt = async () => {
    if (!config) return;
    await navigator.clipboard.writeText(promptText);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 1800);
  };

  const btnStyle: React.CSSProperties = { padding: '5px 16px', fontWeight: 600, fontSize: 12 };
  const preStyle: React.CSSProperties = {
    fontSize: 11, background: 'var(--glass-2)', padding: '10px 12px',
    borderRadius: 6, margin: '0 0 8px 0', color: 'var(--text-secondary)',
    border: '1px solid var(--border-subtle)', lineHeight: 1.6,
    whiteSpace: 'pre-wrap', overflowX: 'auto',
  };

  return (
    <div>
      {/* ========== 交给 Agent 自动配置 ========== */}
      <div className="sec">
        <div className="sec-title">交给 Agent 自动配置</div>
        <div className="sec-desc">
          推荐。复制下面这段话发给任意 AI Agent（Claude、ChatGPT、Cursor、OpenCode、WorkBuddy、QCode 等），它会根据你使用的工具自动完成 MCP 配置
        </div>
        <div className="card">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <pre style={{ ...preStyle, maxHeight: 200, overflowY: 'auto' }}>{promptText}</pre>
            <button className="test-btn success" onClick={copyAgentPrompt} style={btnStyle}>
              {copiedPrompt ? '已复制指令' : '复制配置指令'}
            </button>
          </div>
        </div>
      </div>

      {/* ========== 自己手动配置 ========== */}
      <div className="sec">
        <div className="sec-title">自己手动配置</div>
        <div className="sec-desc">
          将以下 JSON 粘贴到 MCP 客户端的配置文件中（
          {isPackaged ? 'OCRFlow 自带运行时，无需安装 Node.js。' : '开发环境使用系统 Node.js。'}
          软件移动位置后需重新复制）
        </div>
        <div className="card">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <pre style={preStyle}>{config || '正在生成...'}</pre>
            <button className="test-btn" onClick={copyConfig} style={btnStyle}>
              {copiedConfig ? '已复制' : '复制 MCP 配置'}
            </button>
          </div>
        </div>
      </div>

      {/* ========== 命令行调用 ========== */}
      <div className="sec">
        <div className="sec-title">命令行调用（CLI）</div>
        <div className="sec-desc">无需打开 GUI，通过命令行批量 OCR。Token 等配置复用 GUI 设置</div>
        <div className="card">
          <div className="row">
            <span className="lbl" style={{ minWidth: 140 }}>基础用法</span>
            <div className="ctrl" style={{ flex: 1 }}>
              <code style={{ fontSize: 11, background: 'var(--glass-2)', padding: '3px 8px', borderRadius: 4 }}>
                OCRFlow.exe --headless parse "D:\docs\report.pdf" --out "D:\ocr-out" --json
              </code>
            </div>
          </div>
          <div className="row" style={{ borderBottom: 'none' }}>
            <span className="lbl" style={{ minWidth: 140 }}>
              支持参数
              <span className="hint">所有参数均可组合使用</span>
            </span>
            <div className="ctrl" style={{ flex: 1 }}>
              <code style={{ fontSize: 11, background: 'var(--glass-2)', padding: '3px 8px', borderRadius: 4, whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                {'--out <目录>     指定本次输出目录\n--provider <名称>  指定单个服务商：auto / mineru-cloud / paddleocr-cloud\n--providers <列表> 指定 fallback 顺序，逗号分隔\n--concurrency <N>  并发数 1-8\n--chunk-size <N>    每块页数\n--json              输出 JSON 摘要（方便 Agent 读取）\n--help              查看完整帮助'}
              </code>
            </div>
          </div>
        </div>
      </div>

      {/* ========== MCP 参数速查 ========== */}
      <div className="sec">
        <div className="sec-title">MCP 参数速查</div>
        <div className="sec-desc">parse_documents 工具支持的完整参数列表</div>
        <div className="card">
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', color: 'var(--text-secondary)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, width: 100 }}>参数</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, width: 60 }}>类型</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, width: 50 }}>必填</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, width: 80 }}>默认值</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '3px 8px' }}><code>paths</code></td>
                <td style={{ padding: '3px 8px' }}>string[]</td>
                <td style={{ padding: '3px 8px', color: 'var(--red)' }}>是</td>
                <td style={{ padding: '3px 8px' }}>—</td>
                <td style={{ padding: '3px 8px' }}>文件或文件夹的绝对路径列表。Windows 建议使用正斜杠或双反斜杠</td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '3px 8px' }}><code>outputDir</code></td>
                <td style={{ padding: '3px 8px' }}>string</td>
                <td style={{ padding: '3px 8px' }}>否</td>
                <td style={{ padding: '3px 8px' }}>GUI 输出目录</td>
                <td style={{ padding: '3px 8px' }}>本次解析的输出目录，不填则使用 GUI 设置</td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '3px 8px' }}><code>providers</code></td>
                <td style={{ padding: '3px 8px' }}>string[]</td>
                <td style={{ padding: '3px 8px' }}>否</td>
                <td style={{ padding: '3px 8px' }}>GUI 优先级</td>
                <td style={{ padding: '3px 8px' }}>服务商 fallback 顺序，如 <code>["mineru-cloud", "paddleocr-cloud"]</code></td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '3px 8px' }}><code>provider</code></td>
                <td style={{ padding: '3px 8px' }}>string</td>
                <td style={{ padding: '3px 8px' }}>否</td>
                <td style={{ padding: '3px 8px' }}>auto</td>
                <td style={{ padding: '3px 8px' }}>指定单个服务商。可选：<code>auto</code> / <code>mineru-cloud</code> / <code>paddleocr-cloud</code></td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '3px 8px' }}><code>concurrency</code></td>
                <td style={{ padding: '3px 8px' }}>number</td>
                <td style={{ padding: '3px 8px' }}>否</td>
                <td style={{ padding: '3px 8px' }}>GUI 设置</td>
                <td style={{ padding: '3px 8px' }}>并发任务数，范围 1-8</td>
              </tr>
              <tr>
                <td style={{ padding: '3px 8px' }}><code>chunkSize</code></td>
                <td style={{ padding: '3px 8px' }}>number</td>
                <td style={{ padding: '3px 8px' }}>否</td>
                <td style={{ padding: '3px 8px' }}>GUI 设置</td>
                <td style={{ padding: '3px 8px' }}>PDF 每块页数</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ========== 调用示例 ========== */}
      <div className="sec">
        <div className="sec-title">调用示例</div>
        <div className="sec-desc">Agent 调用 parse_documents 时的 JSON 参数（路径请替换为本机实际路径）</div>
        <div className="card">
          <pre style={{ ...preStyle, margin: 0 }}>{`{
  "paths": ["C:/Users/你的用户名/Documents/report.pdf", "C:/Users/你的用户名/Desktop/ocr-in"],
  "outputDir": "C:/Users/你的用户名/Desktop/ocr-out",
  "providers": ["mineru-cloud", "paddleocr-cloud"]
}`}</pre>
        </div>
      </div>
    </div>
  );
}
