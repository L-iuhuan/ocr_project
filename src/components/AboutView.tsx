import { useState, useEffect } from 'react';

export default function AboutView() {
  const [appVersion, setAppVersion] = useState('1.0.2');

  useEffect(() => {
    fetch('/package.json')
      .then(r => r.json())
      .then(pkg => { if (pkg.version) setAppVersion(pkg.version); })
      .catch(() => { /* use default */ });
  }, []);

  return (
    <div className="about-view">
      <div className="about-hero">
        <div className="about-logo">OCRFlow</div>
        <div className="about-version">v{appVersion}</div>
        <p className="about-desc">
          多引擎 OCR 文档批量处理工具 — 支持 PDF、PPTX、DOCX、XLSX 及多种图片格式的智能识别与结构化输出，提供 MinerU Cloud、PaddleOCR Cloud、本地 OCR 引擎三种处理引擎。
        </p>
      </div>

      <div className="about-section">
        <div className="sec-title">技术栈</div>
        <div className="about-grid">
          <div className="about-tag">Electron 28</div>
          <div className="about-tag">React 18 + TypeScript</div>
          <div className="about-tag">Vite 5</div>
          <div className="about-tag">Tailwind CSS</div>
          <div className="about-tag">MinerU API v4</div>
          <div className="about-tag">PaddleOCR-VL</div>
          <div className="about-tag">Ollama (LLM)</div>
          <div className="about-tag">Sharp (图像)</div>
          <div className="about-tag">pdf-lib</div>
          <div className="about-tag">adm-zip</div>
          <div className="about-tag">form-data</div>
          <div className="about-tag">axios</div>
        </div>
        <div className="about-meta" style={{ marginTop: 14, fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', gap: 24 }}>
          <div className="about-meta-item" style={{ display: 'flex', gap: 6 }}>
            <span className="about-meta-label" style={{ opacity: 0.6 }}>开发者</span>
            <span className="about-meta-value">LIU HUAN</span>
          </div>
          <div className="about-meta-item" style={{ display: 'flex', gap: 6 }}>
            <span className="about-meta-label" style={{ opacity: 0.6 }}>许可证</span>
            <span className="about-meta-value">MIT License</span>
          </div>
          <div className="about-meta-item" style={{ display: 'flex', gap: 6 }}>
            <span className="about-meta-label" style={{ opacity: 0.6 }}>构建日期</span>
            <span className="about-meta-value">{new Date().toLocaleDateString('zh-CN')}</span>
          </div>
        </div>
      </div>

      <div className="about-section">
        <div className="sec-title">支持格式</div>
        <div className="about-grid">
          {['PDF', 'PPTX', 'DOCX', 'XLSX', 'PNG', 'JPG', 'JPEG', 'WebP', 'GIF', 'BMP', 'TIFF', 'TXT', 'WPS', 'OFD'].map(f => (
            <div key={f} className="about-tag">{f}</div>
          ))}
        </div>
      </div>

      <div className="about-section">
        <div className="sec-title">输出格式</div>
        <div className="about-grid">
          {['Markdown (md)', 'JSON (结构化)', 'HTML', 'DOCX'].map(f => (
            <div key={f} className="about-tag">{f}</div>
          ))}
        </div>
      </div>

      <div className="about-section">
        <div className="sec-title">功能特性</div>
        <ul className="about-features">
          <li>多引擎智能路由 — 根据 Provider 优先级自动分配任务</li>
          <li>大文件自动拆分 — 按页数阈值拆分超大文档并行处理</li>
          <li>处理结果合并 — 拆分块完成后自动按原始顺序合并输出</li>
          <li>图片收集与路径重写 — 自动汇聚图片并按相对路径重写引用</li>
          <li>ZIP 自动解压 — 支持 MinerU 输出的 ZIP 包自动解压</li>
          <li>Provider 故障转移 — 连续失败自动切换到备用 Provider</li>
          <li>本地 OCR 引擎 — Python 子进程，可接入 PaddleOCR / MinerU 等</li>
          <li>Ollama/OpenAI 兼容推理 — 可扩展的 LLM 后处理</li>
          <li>拖放添加文件/文件夹 — 批量快速导入</li>
          <li>任务队列管理 — 暂停/恢复/重试/取消</li>
          <li>多主题切换 — 深色/浅色/自动，多套配色方案</li>
          <li>处理日志实时追踪 — 搜索/过滤/级别分类</li>
          <li>累计统计 — 累计&今日文件数、页数、成功/失败数</li>
        </ul>
      </div>

      <div className="about-footer">
        <p className="about-copyright">&copy; 2026 OCRFlow — 让文档处理更高效</p>
      </div>
    </div>
  );
}
