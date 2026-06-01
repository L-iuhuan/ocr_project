import Toggle from './Toggle';

interface Props {
  settings: {
    outputDir: string;
    outputFormats: string[];
    outputFileNameTemplate: string;
    concurrency: number;
    chunkSize: number;
    deleteChunkTemp?: boolean;
    keepImages?: boolean;
    imageOutputDir?: string;
  };
  toggles: Record<string, boolean>;
  updateSetting: (key: string, value: unknown) => void;
  toggleSwitch: (id: string) => void;
  toggleOutputFormat: (format: string, checked: boolean) => void;
  chooseOutputDir: () => void;
  chooseImageOutputDir: () => void;
}

export default function GeneralSettings({
  settings, toggles,
  updateSetting, toggleSwitch, toggleOutputFormat, chooseOutputDir, chooseImageOutputDir,
}: Props) {
  return (
    <div>
      {/* 输出设置 */}
      <div className="sec">
        <div className="sec-title">输出设置</div>
        <div className="sec-desc">控制处理结果的保存格式和路径</div>
        <div className="card">
          <div className="row">
            <span className="lbl">
              输出格式
              <span className="hint">可多选，选中的格式都会生成</span>
            </span>
            <div className="ctrl">
              <div className="chk-group">
                <label className="chk-item">
                  <input type="checkbox" checked={(settings.outputFormats || []).includes('md')} onChange={e => toggleOutputFormat('md', e.target.checked)} /> Markdown
                </label>
                <label className="chk-item">
                  <input type="checkbox" checked={(settings.outputFormats || []).includes('html')} onChange={e => toggleOutputFormat('html', e.target.checked)} /> HTML
                </label>
                <label className="chk-item">
                  <input type="checkbox" checked={(settings.outputFormats || []).includes('json')} onChange={e => toggleOutputFormat('json', e.target.checked)} /> JSON
                </label>
                <label className="chk-item">
                  <input type="checkbox" checked={(settings.outputFormats || []).includes('docx')} onChange={e => toggleOutputFormat('docx', e.target.checked)} /> DOCX
                </label>
              </div>
            </div>
          </div>
          <div className="row">
            <span className="lbl">输出目录</span>
            <div className="ctrl">
              <input className="inp w240" value={settings.outputDir || ''} onChange={e => updateSetting('outputDir', e.target.value)} />
              <button className="test-btn" onClick={chooseOutputDir}>浏览</button>
            </div>
          </div>
          <div className="row" style={{ borderBottom: 'none' }}>
            <span className="lbl">
              文件命名模板
              <span className="hint">点击变量插入。{'{name}'}=原名 {'{date}'}=日期 {'{time}'}=时间 {'{timestamp}'}=时间戳</span>
            </span>
            <div className="ctrl" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
              <input className="inp" value={settings.outputFileNameTemplate || ''} onChange={e => updateSetting('outputFileNameTemplate', e.target.value)} style={{ width: 260 }} placeholder="{date}/{name}" />
              <div className="tmpl-hints">
                <span className="tmpl-hint" onClick={() => updateSetting('outputFileNameTemplate', (settings.outputFileNameTemplate || '') + '{name}')}>{'{name}'}</span>
                <span className="tmpl-hint" onClick={() => updateSetting('outputFileNameTemplate', (settings.outputFileNameTemplate || '') + '{date}')}>{'{date}'}</span>
                <span className="tmpl-hint" onClick={() => updateSetting('outputFileNameTemplate', (settings.outputFileNameTemplate || '') + '{time}')}>{'{time}'}</span>
                <span className="tmpl-hint" onClick={() => updateSetting('outputFileNameTemplate', (settings.outputFileNameTemplate || '') + '{timestamp}')}>{'{timestamp}'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 并发处理 */}
      <div className="sec">
        <div className="sec-title">并发处理</div>
        <div className="sec-desc">控制任务的并行度，合理设置可提高处理效率</div>
        <div className="card">
          <div className="row">
            <span className="lbl">最大并发文件数<span className="hint">同时处理几个文件（过多可能耗尽 API 配额）</span></span>
            <div className="ctrl">
              <div className="sldr-group">
                <input type="range" min={1} max={8} value={settings.concurrency || 2} onChange={e => updateSetting('concurrency', Number(e.target.value))} className="slider" />
                <span className="sldr-val">{settings.concurrency || 2}</span>
              </div>
            </div>
          </div>
          <div className="row" style={{ borderBottom: 'none' }}>
            <span className="lbl">
              分块大小
              <span className="hint">每块最大页数。实际 = min(此值, API限制)。{settings.chunkSize || 10}页/块</span>
            </span>
            <div className="ctrl" style={{ gap: 4 }}>
              {[20, 50, 100, 200].map(n => (
                <button key={n} className="test-btn" style={{
                  padding: '2px 8px', fontSize: 11, fontWeight: (settings.chunkSize || 10) === n ? 700 : 400,
                  background: (settings.chunkSize || 10) === n ? 'var(--accent-soft)' : undefined,
                  borderColor: (settings.chunkSize || 10) === n ? 'var(--accent-border)' : undefined,
                }} onClick={() => updateSetting('chunkSize', n)}>{n}页</button>
              ))}
              <input className="inp" type="number" min={1} max={200} value={settings.chunkSize || 20}
                onChange={e => updateSetting('chunkSize', Math.max(1, Math.min(200, Number(e.target.value) || 20)))}
                style={{ width: 52, textAlign: 'center' }} />
            </div>
          </div>
        </div>
      </div>

      {/* 后处理 */}
      <div className="sec">
        <div className="sec-title">后处理</div>
        <div className="sec-desc">
          自动适配服务商返回格式，统一合并为完整文档<br />
          MinerU（ZIP）→ 解压 → md + 图片 &nbsp; PaddleOCR（JSONL）→ 解析 → 文本内容<br />
          所有分块处理完成后 → 合并 → 收集图片 → 更新路径 → 输出最终文件
        </div>
        <div className="card">
          <div className="row">
            <span className="lbl">合并后删除分块临时文件<span className="hint">每个分块解压出的临时文件太多</span></span>
            <div className="ctrl">
              <Toggle on={toggles.deleteTemp} onChange={() => toggleSwitch('deleteTemp')} />
            </div>
          </div>
          <div className="row">
            <span className="lbl">保留识别到的图片<span className="hint">图片会提取到 images/ 子目录并嵌入 Markdown</span></span>
            <div className="ctrl">
              <Toggle on={toggles.keepImages} onChange={() => toggleSwitch('keepImages')} />
            </div>
          </div>
          <div className="row" style={{ borderBottom: 'none' }}>
            <span className="lbl">图片保存路径</span>
            <div className="ctrl">
              <input className="inp w240" value={settings.imageOutputDir || ''} onChange={e => updateSetting('imageOutputDir', e.target.value)} placeholder="留空 = 跟随输出目录" />
              <button className="test-btn" onClick={chooseImageOutputDir}>浏览</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
