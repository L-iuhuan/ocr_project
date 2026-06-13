import { useEffect, useState } from 'react';

export default function AgentMcpSettings() {
  const [config, setConfig] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.electronAPI?.getMcpConfig?.().then(setConfig).catch(() => {});
  }, []);

  const copy = async () => {
    if (!config) return;
    await navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div>
      {/* MCP 工具介绍 */}
      <div className="sec">
        <div className="sec-title">MCP 工具接口</div>
        <div className="sec-desc">OCRFlow 以标准 MCP Tool 方式开放 OCR 能力，支持所有兼容 MCP stdio 协议的 Agent</div>
        <div className="card">
          <div className="row">
            <span className="lbl">
              工具名称
              <span className="hint">MCP 调用时使用的 tool name</span>
            </span>
            <div className="ctrl"><code style={{ fontSize: 12, background: 'var(--glass-2)', padding: '2px 8px', borderRadius: 4 }}>parse_documents</code></div>
          </div>
          <div className="row" style={{ borderBottom: 'none' }}>
            <span className="lbl">
              调用方式
              <span className="hint">复用 GUI 中已保存的 OCR 服务商设置（Token、优先级等）</span>
            </span>
            <div className="ctrl"><span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>传入文件路径 → 自动 OCR → 保存 Markdown → 返回结果摘要</span></div>
          </div>
        </div>
      </div>

      {/* 支持参数 */}
      <div className="sec">
        <div className="sec-title">工具参数</div>
        <div className="sec-desc">parse_documents 支持的输入参数</div>
        <div className="card">
          <div className="row" style={{ borderBottom: 'none', flexWrap: 'wrap' }}>
            <span className="lbl" style={{ width: '100%', marginBottom: 6 }}>
              参数说明
              <span className="hint">所有路径建议使用正斜杠或双反斜杠</span>
            </span>
            <div className="ctrl" style={{ width: '100%' }}>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', color: 'var(--text-secondary)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, width: 110 }}>参数</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, width: 70 }}>类型</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, width: 60 }}>必填</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '3px 8px' }}><code>paths</code></td>
                    <td style={{ padding: '3px 8px' }}>string[]</td>
                    <td style={{ padding: '3px 8px', color: 'var(--red)' }}>是</td>
                    <td style={{ padding: '3px 8px' }}>文件或文件夹的绝对路径列表</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '3px 8px' }}><code>outputDir</code></td>
                    <td style={{ padding: '3px 8px' }}>string</td>
                    <td style={{ padding: '3px 8px' }}>否</td>
                    <td style={{ padding: '3px 8px' }}>输出目录，不填则使用 GUI 设置</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '3px 8px' }}><code>provider</code></td>
                    <td style={{ padding: '3px 8px' }}>enum</td>
                    <td style={{ padding: '3px 8px' }}>否</td>
                    <td style={{ padding: '3px 8px' }}>指定单个服务商：auto / mineru-cloud / paddleocr-cloud</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '3px 8px' }}><code>providers</code></td>
                    <td style={{ padding: '3px 8px' }}>string[]</td>
                    <td style={{ padding: '3px 8px' }}>否</td>
                    <td style={{ padding: '3px 8px' }}>指定 fallback 顺序，如 [&quot;mineru-cloud&quot;, &quot;paddleocr-cloud&quot;]</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '3px 8px' }}><code>concurrency</code></td>
                    <td style={{ padding: '3px 8px' }}>number</td>
                    <td style={{ padding: '3px 8px' }}>否</td>
                    <td style={{ padding: '3px 8px' }}>并发数，1-8，默认使用 GUI 设置</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '3px 8px' }}><code>chunkSize</code></td>
                    <td style={{ padding: '3px 8px' }}>number</td>
                    <td style={{ padding: '3px 8px' }}>否</td>
                    <td style={{ padding: '3px 8px' }}>每块页数，默认使用 GUI 设置</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* 命令行调用 */}
      <div className="sec">
        <div className="sec-title">命令行调用</div>
        <div className="sec-desc">无需打开 GUI，通过命令行完成批量 OCR。Token 等配置复用 GUI 设置</div>
        <div className="card">
          <div className="row">
            <span className="lbl">基础用法</span>
            <div className="ctrl" style={{ flex: 1 }}>
              <pre style={{
                fontSize: 11, background: 'var(--glass-2)', padding: '6px 10px',
                borderRadius: 6, margin: 0, overflowX: 'auto', color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}>{'OCRFlow.exe --headless parse "D:\\docs\\report.pdf" --out "D:\\ocr-output"'}</pre>
            </div>
          </div>
          <div className="row">
            <span className="lbl">批量文件夹</span>
            <div className="ctrl" style={{ flex: 1 }}>
              <pre style={{
                fontSize: 11, background: 'var(--glass-2)', padding: '6px 10px',
                borderRadius: 6, margin: 0, overflowX: 'auto', color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}>{'OCRFlow.exe --headless parse "D:\\docs\\folder" --provider mineru-cloud --json'}</pre>
            </div>
          </div>
          <div className="row">
            <span className="lbl">开发环境</span>
            <div className="ctrl" style={{ flex: 1 }}>
              <pre style={{
                fontSize: 11, background: 'var(--glass-2)', padding: '6px 10px',
                borderRadius: 6, margin: 0, overflowX: 'auto', color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}>{'npm run parse -- "D:\\docs\\report.pdf" --providers mineru-cloud,paddleocr-cloud --json'}</pre>
            </div>
          </div>
          <div className="row" style={{ borderBottom: 'none' }}>
            <span className="lbl">CLI 选项</span>
            <div className="ctrl" style={{ flex: 1 }}>
              <pre style={{
                fontSize: 11, background: 'var(--glass-2)', padding: '6px 10px',
                borderRadius: 6, margin: 0, overflowX: 'auto', color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}>{'--out <目录>  --provider <厂商>  --providers <厂商列表>  --concurrency <n>\n--chunk-size <n>  --json  --help'}</pre>
            </div>
          </div>
        </div>
      </div>

      {/* MCP 配置 */}
      <div className="sec">
        <div className="sec-title">MCP 配置</div>
        <div className="sec-desc">复制以下 JSON 到你的 MCP 客户端配置文件。生成时会自动使用当前软件的可执行文件作为 MCP 运行时，无需额外安装 Node.js。</div>
        <div className="card">
          <div className="row" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'stretch' }}>
            <pre style={{
              fontSize: 11, background: 'var(--glass-2)', padding: '10px 12px',
              borderRadius: 6, margin: '0 0 8px 0', overflowX: 'auto', color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)', maxHeight: 220, overflowY: 'auto', lineHeight: 1.6,
            }}>{config || '正在生成配置...'}</pre>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button className="test-btn" onClick={copy}>{copied ? '已复制' : '复制 MCP 配置'}</button>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                提示：如果移动了软件位置，MCP 配置会失效，需要重新复制
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 示例调用 */}
      <div className="sec">
        <div className="sec-title">示例调用</div>
        <div className="sec-desc">MCP Agent 调用 parse_documents 的 JSON 参数</div>
        <div className="card">
          <div className="row" style={{ borderBottom: 'none' }}>
            <pre style={{
              fontSize: 11, background: 'var(--glass-2)', padding: '10px 12px',
              borderRadius: 6, margin: 0, overflowX: 'auto', color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)', lineHeight: 1.6,
            }}>{`{
  "paths": ["D:/docs/report.pdf", "D:/docs/folder"],
  "outputDir": "D:/ocr-output",
  "providers": ["mineru-cloud", "paddleocr-cloud"]
}`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
