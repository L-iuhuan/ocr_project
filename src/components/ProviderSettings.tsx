import { useState, useCallback, useRef, useEffect } from 'react';
import Toggle from './Toggle';

const DOC_PROVIDER_IDS = ['mineru-cloud', 'paddleocr-cloud', 'paddleocr-local'];

interface Settings {
  providers: {
    mineruCloud: { baseUrl: string; token: string };
    paddleocrCloud: { token: string };
    paddleocrLocal: { enabled: boolean; port: number; pythonPath: string };
  };
  providerPriority: string[];
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
}

interface Props {
  settings: Settings;
  updateProvider: (provider: string, key: string, value: unknown) => void;
  toggleLocalOcr: () => void;
  testConnection: (type: string, creds?: unknown) => void;
  testResults: Record<string, { ok?: boolean; message?: string; testing?: boolean }>;
  onReorderPriority?: (newOrder: string[]) => void;
}

interface PriorityItem {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'local' | 'disabled';
  quotaLabel?: string;
  expandKey: string;
}

/**
 * Build the full list of priority items (6 items in total).
 * Doc providers are ordered according to settings.providerPriority.
 * Non-doc items (ollama, openai-compat, local-service) always
 * appear after doc providers in a fixed order — their position
 * in the drag UI doesn't affect processing priority.
 */
function buildPriorityItems(settings: Settings): PriorityItem[] {
  var localEnabled = settings.providers.paddleocrLocal.enabled;

  // Doc providers — order by saved priority
  var docPriority = (settings.providerPriority || []).filter(function(id) {
    return DOC_PROVIDER_IDS.indexOf(id) >= 0;
  });
  // Append any doc provider not in the saved list
  for (var d = 0; d < DOC_PROVIDER_IDS.length; d++) {
    if (docPriority.indexOf(DOC_PROVIDER_IDS[d]) < 0) {
      docPriority.push(DOC_PROVIDER_IDS[d]);
    }
  }

  var allItems: PriorityItem[] = [];

  for (var i = 0; i < docPriority.length; i++) {
    var id = docPriority[i];
    if (id === 'mineru-cloud') {
      allItems.push({ id: 'mineru-cloud', name: 'MinerU Cloud', status: 'online' as const, quotaLabel: '云端服务', expandKey: 'mineru' });
    } else if (id === 'paddleocr-cloud') {
      allItems.push({ id: 'paddleocr-cloud', name: 'PaddleOCR Cloud', status: 'online' as const, quotaLabel: '云端服务', expandKey: 'paddle' });
    } else if (id === 'paddleocr-local') {
      allItems.push({ id: 'paddleocr-local', name: '本地 OCR 引擎', status: localEnabled ? 'local' as const : 'offline' as const, quotaLabel: localEnabled ? '活跃' : '未启用', expandKey: 'localOcr' });
    }
  }


  return allItems;
}

export default function ProviderSettings({
  settings,
  updateProvider,
  toggleLocalOcr,
  testConnection,
  testResults,
  onReorderPriority,
}: Props) {
  var [expanded, setExpanded] = useState<Record<string, boolean>>({ mineru: true });
  var [items, setItems] = useState<PriorityItem[]>(function() { return buildPriorityItems(settings); });
  var dragRef = useRef<{ index: number }>({ index: -1 });
  // Track the doc-provider order that last came from settings (not from drag).
  // When settings.providerPriority diverges from this, we know an external
  // change happened and items need a full rebuild; otherwise only refresh labels.
  var lastSettingsDocOrderRef = useRef('');

  var toggle = function(id: string) { setExpanded(function(p) { var n: Record<string, boolean> = {}; for (var k in p) n[k] = p[k]; n[id] = !p[id]; return n; }); };

  // Sync items when settings change — runs AFTER render, so handleDrop's
  // setItems has already been committed. This avoids the render-phase race
  // where setItems(newDragOrder) and setSettings(newPriority) fire together
  // but the render-phase comparison reads stale items state.
  useEffect(function() {
    var newItems = buildPriorityItems(settings);
    var newDocOrder = newItems
      .filter(function(it) { return DOC_PROVIDER_IDS.indexOf(it.id) >= 0; })
      .map(function(it) { return it.id; })
      .join(',');

    if (newDocOrder !== lastSettingsDocOrderRef.current) {
      // External order change (e.g. loaded from disk, or toggled local OCR) —
      // full rebuild.
      lastSettingsDocOrderRef.current = newDocOrder;
      setItems(newItems);
    } else {
      // Same order — only refresh statuses / quota labels in place.
      setItems(function(current) {
        var changed = false;
        var next = current.map(function(item) {
          var fresh = newItems.find(function(f) { return f.id === item.id; });
          if (!fresh) return item;
          if (item.status !== fresh.status || item.quotaLabel !== fresh.quotaLabel) {
            changed = true;
            return { ...item, status: fresh.status, quotaLabel: fresh.quotaLabel };
          }
          return item;
        });
        return changed ? next : current;
      });
    }
  }, [settings]);

  var handleDragStart = useCallback(function(e: React.DragEvent, index: number) {
    dragRef.current.index = index;
    (e.target as HTMLElement).style.opacity = '0.4';
  }, []);

  var handleDragEnd = useCallback(function(e: React.DragEvent) {
    (e.target as HTMLElement).style.opacity = '1';
  }, []);

  var handleDragOver = useCallback(function(e: React.DragEvent) {
    e.preventDefault();
  }, []);

  var handleDrop = useCallback(function(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    var dragIndex = dragRef.current.index;
    if (dragIndex === dropIndex || dragIndex < 0) return;

    var newItems = items.slice();
    var moved = newItems.splice(dragIndex, 1)[0];
    newItems.splice(dropIndex, 0, moved);
    setItems(newItems);
    dragRef.current.index = -1;

    // Only doc providers affect processing priority — extract and save just those
    var docOrder = newItems
      .map(function(item) { return item.id; })
      .filter(function(id) { return DOC_PROVIDER_IDS.indexOf(id) >= 0; });

    // Sync the ref so the useEffect doesn't overwrite this drag on the next cycle
    lastSettingsDocOrderRef.current = docOrder.join(',');

    // Update parent state AND persist to backend
    onReorderPriority?.(docOrder);
    window.electronAPI?.setProviderPriority(docOrder);
  }, [items, onReorderPriority]);

  var statusClass = function(status: string) {
    if (status === 'online') return 'on';
    if (status === 'local') return 'local';
    return 'off';
  };

  var testBtnClass = function(providerKey: string): string {
    var r = testResults[providerKey];
    if (r?.testing) return 'test-btn';
    if (r?.ok === true) return 'test-btn success';
    if (r?.ok === false) return 'test-btn fail';
    return 'test-btn';
  };

  var testBtnLabel = function(providerKey: string): string {
    var r = testResults[providerKey];
    if (r?.testing) return '测试中...';
    if (r?.ok === true) return '✓ ' + (r.message || '连接成功');
    if (r?.ok === false) return '✗ ' + (r.message || '连接失败');
    return '测试连接';
  };

  var renderConfig = function(expandKey: string) {
    switch (expandKey) {
      case 'mineru':
        return (
          <div className={'provider-config' + (expanded.mineru ? ' open' : '')}>
            <div className="row">
              <span className="lbl">接口地址</span>
              <div className="ctrl"><input className="inp w240" value={settings.providers.mineruCloud.baseUrl || ''} onChange={function(e) { updateProvider('mineruCloud', 'baseUrl', e.target.value); }} /></div>
            </div>
            <div className="row">
              <span className="lbl">API Token</span>
              <div className="ctrl"><input className="inp w240" type="password" value={settings.providers.mineruCloud.token || ''} onChange={function(e) { updateProvider('mineruCloud', 'token', e.target.value); }} placeholder="留空使用 Agent 模式" /></div>
            </div>
            <div className="row">
              <span className="lbl">连接测试</span>
              <div className="ctrl"><button className={testBtnClass('mineru-cloud')} onClick={function() { testConnection('mineru-cloud', { token: settings.providers.mineruCloud.token, baseUrl: settings.providers.mineruCloud.baseUrl }); }} disabled={testResults['mineru-cloud']?.testing}>{testBtnLabel('mineru-cloud')}</button></div>
            </div>
          </div>
        );
      case 'paddle':
        return (
          <div className={'provider-config' + (expanded.paddle ? ' open' : '')}>
            <div className="row">
              <span className="lbl">接口地址</span>
              <div className="ctrl"><input className="inp w240" value="https://paddleocr.aistudio-app.com/api/v2/ocr" readOnly style={{ opacity: 0.65 }} /></div>
            </div>
            <div className="row" style={{ borderBottom: 'none' }}>
              <span className="lbl">Access Token</span>
              <div className="ctrl">
                <input className="inp w240" type="password" value={settings.providers.paddleocrCloud.token || ''} onChange={function(e) { updateProvider('paddleocrCloud', 'token', e.target.value); }} placeholder="PaddleOCR Token" />
                <button className={testBtnClass('paddleocr-cloud')} onClick={function() { testConnection('paddleocr-cloud', { token: settings.providers.paddleocrCloud.token }); }} disabled={testResults['paddleocr-cloud']?.testing}>{testBtnLabel('paddleocr-cloud')}</button>
              </div>
            </div>
          </div>
        );
      case 'localOcr':
        return (
          <div className={'provider-config' + (expanded.localOcr ? ' open' : '')}>
            <div className="row">
              <span className="lbl">启用</span>
              <div className="ctrl"><Toggle on={settings.providers.paddleocrLocal.enabled} onChange={toggleLocalOcr} /></div>
            </div>
            <div className="row">
              <span className="lbl">服务端口</span>
              <div className="ctrl"><input className="inp" type="number" value={settings.providers.paddleocrLocal.port || 51987} onChange={function(e) { updateProvider('paddleocrLocal', 'port', Number(e.target.value)); }} style={{ width: 90 }} min={1024} max={65535} placeholder="51987" /></div>
            </div>
            <div className="row">
              <span className="lbl">Python 路径</span>
              <div className="ctrl"><input className="inp w240" value={settings.providers.paddleocrLocal.pythonPath || 'python'} onChange={function(e) { updateProvider('paddleocrLocal', 'pythonPath', e.target.value); }} placeholder="python" /></div>
            </div>
            <div className="row" style={{ borderBottom: 'none' }}>
              <span className="lbl">连接测试</span>
              <div className="ctrl"><button className={testBtnClass('paddleocr-local')} onClick={function() { testConnection('paddleocr-local', { port: settings.providers.paddleocrLocal.port, pythonPath: settings.providers.paddleocrLocal.pythonPath }); }} disabled={testResults['paddleocr-local']?.testing}>{testBtnLabel('paddleocr-local')}</button></div>
            </div>
          </div>
        );
      case 'ollama':
        return (
          <div className={'provider-config' + (expanded.ollama ? ' open' : '')}>
            <div className="row">
              <span className="lbl">服务地址</span>
              <div className="ctrl"><input className="inp" defaultValue={settings.ollamaUrl || 'http://localhost:11434'} style={{ width: 180 }} /><button className={testBtnClass('ollama')} onClick={function() { testConnection('ollama', { url: settings.ollamaUrl }); }} disabled={testResults['ollama']?.testing}>{testBtnLabel('ollama')}</button></div>
            </div>
            <div className="row" style={{ borderBottom: 'none' }}>
              <span className="lbl">视觉模型</span>
              <div className="ctrl"><select className="sel"><option>llama3.2-vision:11b</option><option>llama3.2-vision:90b</option><option>minicpm-v</option><option>qwen2-vl:7b</option><option>llava:13b</option></select><button className="test-btn">拉取模型</button></div>
            </div>
          </div>
        );
      case 'openai':
        return (
          <div className={'provider-config' + (expanded.openai ? ' open' : '')}>
            <div className="row">
              <span className="lbl">服务地址</span>
              <div className="ctrl"><input className="inp" defaultValue={settings.openaiCompatUrl || 'http://localhost:1234'} style={{ width: 180 }} /><button className={testBtnClass('openai-compat')} onClick={function() { testConnection('openai-compat', { url: settings.openaiCompatUrl }); }} disabled={testResults['openai-compat']?.testing}>{testBtnLabel('openai-compat')}</button></div>
            </div>
            <div className="row" style={{ borderBottom: 'none' }}><span className="lbl">模型名称</span><div className="ctrl"><input className="inp" defaultValue={settings.openaiCompatModel || ''} style={{ width: 180 }} placeholder="留空使用默认" /></div></div>
          </div>
        );
      case 'localService':
        return (
          <div className={'provider-config' + (expanded.localService ? ' open' : '')}>
            <div className="row"><span className="lbl">协议类型</span><div className="ctrl"><select className="sel"><option>MinerU 本地服务</option><option>PaddleOCR 本地服务</option></select></div></div>
            <div className="row" style={{ borderBottom: 'none' }}><span className="lbl">服务地址</span><div className="ctrl"><input className="inp" defaultValue={settings.localServiceUrl || 'http://localhost:8000'} style={{ width: 200 }} /><button className={testBtnClass('local-service')} onClick={function() { testConnection('local-service', { url: settings.localServiceUrl }); }} disabled={testResults['local-service']?.testing}>{testBtnLabel('local-service')}</button></div></div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div>
      <div className="sec">
        <div className="sec-title">服务商优先级</div>
        <div className="sec-desc">
          拖拽调整顺序。排在前面的优先使用，配额用尽后自动切换至下一个服务商。
        </div>
        <div className="card">
          {items.map(function(item, index) {
            return (
              <div key={item.id}>
                <div
                  className="prio-item"
                  draggable
                  onDragStart={function(e) { handleDragStart(e, index); }}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDrop={function(e) { handleDrop(e, index); }}
                  onClick={function(e) {
                    var t = e.target as HTMLElement;
                    if (!t.closest('.drg') && !t.closest('button')) toggle(item.expandKey);
                  }}
                >
                  <span className="drg">::</span>
                  <span className="pname">{index + 1}. {item.name}</span>
                  <span className={'pstatus ' + statusClass(item.status)}>
                    {item.status === 'online' ? '● 在线 · ' :
                     item.status === 'local' ? '● ' :
                     '✖ '}
                    {item.quotaLabel}
                  </span>
                  <span className={'arrow' + (expanded[item.expandKey] ? ' open' : '')}>▼</span>
                </div>
                {renderConfig(item.expandKey)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
