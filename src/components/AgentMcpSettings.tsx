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
    <div className="settings-section">
      <h3>Agent / MCP 调用</h3>
      <p className="muted">
        OCRFlow 提供标准 MCP 工具 <code>parse_documents</code>，支持 Claude Code、Claude Desktop、Cursor、Cherry Studio 等兼容 MCP stdio 协议的 Agent 工具调用。它会复用本软件里已保存的 OCR 服务商配置，批量解析本地文件/文件夹，输出 Markdown。
      </p>

      <div className="settings-card">
        <div className="sec-title">使用前提</div>
        <ul className="about-features">
          <li>先在“服务商”页配置 MinerU / PaddleOCR Token，并保存设置。</li>
          <li>机器需要安装 Node.js 18+，因为 MCP Server 以 Node stdio 方式运行。</li>
          <li>输入路径建议使用绝对路径；Windows 路径建议使用正斜杠或双反斜杠。</li>
          <li>大批量任务仍建议打开 GUI 观察进度；MCP 更适合偶尔让 Agent 解析少量文件。</li>
        </ul>
      </div>

      <div className="settings-card">
        <div className="sec-title">工具参数</div>
        <ul className="about-features">
          <li><code>paths</code>：文件或文件夹路径数组，必填。</li>
          <li><code>outputDir</code>：本次输出目录，可选；不填则使用软件设置。</li>
          <li><code>provider</code>：指定单个服务商，例如 <code>mineru-cloud</code>。</li>
          <li><code>providers</code>：指定 fallback 顺序，例如 <code>["mineru-cloud", "paddleocr-cloud"]</code>。</li>
          <li><code>concurrency</code> / <code>chunkSize</code>：临时覆盖并发和分块页数。</li>
        </ul>
      </div>

      <div className="settings-card">
        <div className="sec-title">MCP 配置</div>
        <p className="muted">复制下面配置到你的 MCP 客户端。不同电脑安装路径不同，请以本页面生成的配置为准。</p>
        <pre className="mcp-config-box">{config || '正在生成 MCP 配置...'}</pre>
        <button className="test-btn" onClick={copy}>{copied ? '已复制' : '复制 MCP 配置'}</button>
      </div>

      <div className="settings-card">
        <div className="sec-title">示例调用</div>
        <pre className="mcp-config-box">{`{
  "paths": ["D:/Files/projects/docflow/test-export.pdf"],
  "outputDir": "D:/Files/projects/test",
  "providers": ["mineru-cloud", "paddleocr-cloud"]
}`}</pre>
      </div>
    </div>
  );
}
