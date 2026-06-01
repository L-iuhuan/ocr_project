import Toggle from './Toggle';

interface Props {
  settings: {
    providers: {
      paddleocrLocal: { enabled: boolean; port: number; pythonPath: string };
    };
    ollamaEnabled?: boolean;
    ollamaUrl?: string;
    ollamaModel?: string;
    openaiCompatEnabled?: boolean;
    openaiCompatType?: string;
    openaiCompatUrl?: string;
    openaiCompatModel?: string;
    localServiceEnabled?: boolean;
    localServiceType?: string;
    localServiceUrl?: string;
  };
  toggles: Record<string, boolean>;
  updateProvider: (provider: string, key: string, value: unknown) => void;
  updateSetting: (key: string, value: unknown) => void;
  toggleSwitch: (id: string) => void;
  toggleLocalOcr: () => void;
  testConnection: (type: string, creds?: unknown) => void;
  testResults: Record<string, { ok?: boolean; message?: string; testing?: boolean }>;
}

export default function LocalInferenceSettings({
  settings, toggles, updateProvider, updateSetting, toggleSwitch,
  toggleLocalOcr, testConnection, testResults,
}: Props) {
  const testBtnClass = (providerKey: string): string => {
    const r = testResults[providerKey];
    if (r?.testing) return 'test-btn';
    if (r?.ok === true) return 'test-btn success';
    if (r?.ok === false) return 'test-btn fail';
    return 'test-btn';
  };

  const testBtnLabel = (providerKey: string): string => {
    const r = testResults[providerKey];
    if (r?.testing) return '测试中...';
    if (r?.ok === true) return '✅ ' + (r.message || '连接成功');
    if (r?.ok === false) return '❌ ' + (r.message || '连接失败');
    return '测试连接';
  };

  return (
    <div>
      {/* 本地推理优先级 */}
      <div className="sec">
        <div className="sec-title">本地推理优先级</div>
        <div className="sec-desc">本地处理时，优先使用哪个引擎进行文档解析</div>
        <div className="card">
          <div className="row" style={{ borderBottom: 'none' }}>
            <span className="lbl">优先级顺序</span>
            <div className="ctrl">
              <div className="radio-group">
                <label className="radio-item">
                  <input type="radio" name="localPrio" defaultChecked /> OCR 引擎优先 — 精度高，适合纯文本文档
                </label>
                <label className="radio-item">
                  <input type="radio" name="localPrio" /> 视觉模型优先 — 理解版式，适合图文混排
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 本地 OCR 引擎 */}
      <div className="sec">
        <div className="sec-title">本地 OCR 引擎</div>
        <div className="sec-desc">
          在 localhost 指定端口启动 OCR 服务（PaddleOCR / MinerU 等均可）。<br />
          若服务已在运行则直接连接；若未运行，提供 Python 路径后可自动启动。
        </div>
        <div className="card">
          <div className="row">
            <span className="lbl">启用</span>
            <div className="ctrl">
              <Toggle on={settings.providers.paddleocrLocal.enabled} onChange={toggleLocalOcr} />
            </div>
          </div>
          <div className="row">
            <span className="lbl">服务端口<span className="hint">OCR 服务在 localhost 的监听端口</span></span>
            <div className="ctrl">
              <input className="inp" type="number" value={settings.providers.paddleocrLocal.port || 51987} onChange={e => updateProvider('paddleocrLocal', 'port', Number(e.target.value))} style={{ width: 90 }} min={1024} max={65535} placeholder="51987" />
            </div>
          </div>
          <div className="row">
            <span className="lbl">Python 路径<span className="hint">服务未运行时自动启动所需。留空使用 PATH 中的 python</span></span>
            <div className="ctrl">
              <input className="inp w240" value={settings.providers.paddleocrLocal.pythonPath || 'python'} onChange={e => updateProvider('paddleocrLocal', 'pythonPath', e.target.value)} placeholder="python" />
            </div>
          </div>
          <div className="row" style={{ borderBottom: 'none' }}>
            <span className="lbl">连接测试</span>
            <div className="ctrl">
              <button className={testBtnClass('paddleocr-local')} onClick={() => testConnection('paddleocr-local', { port: settings.providers.paddleocrLocal.port, pythonPath: settings.providers.paddleocrLocal.pythonPath })} disabled={testResults['paddleocr-local']?.testing}>{testBtnLabel('paddleocr-local')}</button>
            </div>
          </div>
        </div>
      </div>

      {/* 视觉大模型（规划中，暂不可用） */}
      <div className="sec" style={{ opacity: 0.45, pointerEvents: 'none' }}>
        <div className="sec-title">视觉大模型（OpenAI 兼容协议）— 规划中</div>
        <div className="sec-desc">
          LLM 后处理功能尚未接入管线。完成后可将解析结果发送至本地视觉模型进行二次分析。
        </div>
        <div className="card">
          <div className="row" style={{ borderBottom: 'none', padding: '12px 0', justifyContent: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>此功能正在开发中，暂不可用</span>
          </div>
        </div>
      </div>
    </div>
  );
}
