import { useEffect, useState, useRef } from 'react';
import ProviderSettings from './ProviderSettings';
import GeneralSettings from './GeneralSettings';
import LocalInferenceSettings from './LocalInferenceSettings';
import AboutView from './AboutView';
import AgentMcpSettings from './AgentMcpSettings';
import type { Settings } from '../types';

interface Props {
  onClose: () => void;
}

type SettingsTab = 'providers' | 'basic' | 'local' | 'agent' | 'about';

const DEFAULT_SETTINGS: Settings = {
  providers: {
    mineruCloud: { baseUrl: 'https://mineru.net/api/v4', token: '' },
    paddleocrCloud: { token: '' },
    paddleocrLocal: { enabled: false, port: 51987, pythonPath: 'python' },
  },
  providerPriority: ['mineru-cloud', 'paddleocr-cloud'],
  outputDir: './output',
  outputFormats: ['md'],
  outputFileNameTemplate: '{date}/{name}',
  concurrency: 2,
  maxChunksPerFile: 3,
  chunkSize: 20,
  theme: 'auto',
  autoStart: false,
  autoExtractZip: true,
  deleteChunkTemp: true,
  keepImages: true,
  imageOutputDir: '', // 留空 = 跟随输出目录
  ollamaEnabled: true,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2-vision:11b',
  openaiCompatEnabled: true,
  openaiCompatType: '自定义 OpenAI 兼容',
  openaiCompatUrl: 'http://127.0.0.1:8080',
  openaiCompatModel: '',
  localServiceEnabled: false,
  localServiceType: 'MinerU 本地服务',
  localServiceUrl: 'http://localhost:8000',
};

export default function SettingsView({ onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>('providers');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [banner, setBanner] = useState<{ text: string; type: 'saving' | 'saved' | '' }>({ text: '', type: '' });
  const settingsLoaded = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [toggles, setToggles] = useState<Record<string, boolean>>({
    deleteTemp: true,
    keepImages: true,
    ocrEnabled: false,
    ollamaEnabled: true,
    openaiCompatEnabled: true,
    localServiceEnabled: false,
  });

  const [testResults, setTestResults] = useState<Record<string, { ok?: boolean; message?: string; testing?: boolean }>>({});

  useEffect(() => {
    Promise.all([
      window.electronAPI?.loadSettings(),
      window.electronAPI?.getDefaultSettings(),
    ]).then(([loaded, defaults]) => {
      const defs = (defaults || DEFAULT_SETTINGS) as Settings;
      const next: Settings = {
        ...defs,
        ...((loaded || {}) as Partial<Settings>),
        providers: {
          ...defs.providers,
          ...((loaded as any)?.providers || {}),
          mineruCloud: { ...defs.providers.mineruCloud, ...((loaded as any)?.providers?.mineruCloud || {}) },
          paddleocrCloud: { ...defs.providers.paddleocrCloud, ...((loaded as any)?.providers?.paddleocrCloud || {}) },
          paddleocrLocal: { ...defs.providers.paddleocrLocal, ...((loaded as any)?.providers?.paddleocrLocal || {}) },
        },
      };
      setSettings(next);
      settingsLoaded.current = true;
      setToggles(prev => ({
        ...prev,
        deleteTemp: next.deleteChunkTemp ?? true,
        keepImages: next.keepImages ?? true,
        ocrEnabled: !!next.providers.paddleocrLocal.enabled,
        ollamaEnabled: next.ollamaEnabled ?? true,
        openaiCompatEnabled: next.openaiCompatEnabled ?? true,
        localServiceEnabled: next.localServiceEnabled ?? false,
      }));
    });
  }, []);

  const updateSetting = (key: string, value: unknown) => {
    setSettings((prev: Settings) => ({ ...prev, [key]: value }));
  };

  const updateProvider = (provider: string, key: string, value: unknown) => {
    setSettings((prev: Settings) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [provider]: { ...((prev.providers as any)[provider] || {}), [key]: value },
      },
    }));
  };

  const toggleSwitch = (id: string) => {
    const next = !toggles[id];
    setToggles(prev => ({ ...prev, [id]: next }));

    // Sync toggle changes to the settings object so they get persisted on save.
    // Maps toggle ID → settings field name.
    const TOGGLE_FIELD_MAP: Record<string, string> = {
      deleteTemp: 'deleteChunkTemp',
      keepImages: 'keepImages',
      ollamaEnabled: 'ollamaEnabled',
      openaiCompatEnabled: 'openaiCompatEnabled',
      localServiceEnabled: 'localServiceEnabled',
    };
    const field = TOGGLE_FIELD_MAP[id];
    if (field) {
      updateSetting(field, next);
    }
    // ocrEnabled is handled by toggleLocalOcr separately
  };

  const toggleOutputFormat = (format: string, checked: boolean) => {
    setSettings((prev: Settings) => {
      const set = new Set(prev.outputFormats || []);
      if (checked) set.add(format);
      else set.delete(format);
      return { ...prev, outputFormats: Array.from(set) };
    });
  };

  const toggleLocalOcr = () => {
    const enabled = !settings.providers.paddleocrLocal.enabled;
    setToggles(prev => ({ ...prev, ocrEnabled: enabled }));
    setSettings((prev: Settings) => ({
      ...prev,
      providers: {
        ...prev.providers,
        paddleocrLocal: { ...prev.providers.paddleocrLocal, enabled },
      },
      providerPriority: enabled
        ? Array.from(new Set([...(prev.providerPriority || []), 'paddleocr-local']))
        : (prev.providerPriority || []).filter((p: string) => p !== 'paddleocr-local'),
    }));
  };

  const chooseOutputDir = async () => {
    const dir = await window.electronAPI?.selectOutputDir();
    if (dir) setSettings((prev: Settings) => ({ ...prev, outputDir: dir }));
  };

  /** Browse button for the image output directory field (different from outputDir). */
  const chooseImageOutputDir = async () => {
    const dir = await window.electronAPI?.selectOutputDir();
    if (dir) setSettings((prev: Settings) => ({ ...prev, imageOutputDir: dir }));
  };

  const testConnection = async (type: string, creds?: unknown) => {
    setTestResults(prev => ({ ...prev, [type]: { testing: true } }));
    try {
      const result = await window.electronAPI?.testProviderConnection(type, creds || {});
      setTestResults(prev => ({ ...prev, [type]: { ok: result?.ok ?? false, message: result?.message ?? '', testing: false } }));
      if (result?.ok) {
        setTimeout(() => {
          setTestResults(prev => {
            const next = { ...prev };
            if (next[type]?.ok) delete next[type];
            return next;
          });
        }, 4000);
      }
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [type]: { ok: false, message: e.message || '测试失败', testing: false } }));
    }
  };

  // Auto-save with 600ms debounce — fires only after settings have been loaded
  useEffect(() => {
    if (!settingsLoaded.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      setBanner({ text: '保存中...', type: 'saving' });
      await window.electronAPI?.saveSettings(settings);
      setBanner({ text: '已保存', type: 'saved' });
      setTimeout(() => setBanner({ text: '', type: '' }), 2500);
    }, 600);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [settings]);

  const saveSettings = async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setBanner({ text: '保存中...', type: 'saving' });
    await window.electronAPI?.saveSettings(settings);
    setBanner({ text: '已保存', type: 'saved' });
    setTimeout(() => setBanner({ text: '', type: '' }), 2500);
  };

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'providers', label: '服务商' },
    { key: 'basic', label: '基本设置' },
    { key: 'local', label: '本地推理' },
    { key: 'agent', label: 'Agent / MCP' },
    { key: 'about', label: '关于' },
  ];

  return (
    <div className="settings-view">
      <div className="settings-tabs">
        {tabs.map(t => (
          <div key={t.key} className={`settings-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </div>
        ))}
      </div>

      <div className="settings-panels" style={{ position: 'relative' }}>
        {banner.text && (
          <div className={`settings-banner ${banner.type}`}>{banner.text}</div>
        )}
        <div className="main-header" style={{ marginBottom: 12 }}>
          <div>
            <h2>设置</h2>
          </div>
          {tab !== 'about' && <button className="test-btn success" onClick={saveSettings}>保存设置</button>}
        </div>

        <div className={`settings-panel${tab === 'providers' ? ' active' : ''}`}>
          <ProviderSettings
            settings={settings}
            updateProvider={updateProvider}
            toggleLocalOcr={toggleLocalOcr}
            testConnection={testConnection}
            testResults={testResults}
            onReorderPriority={order => setSettings(prev => ({ ...prev, providerPriority: order }))}
          />
        </div>

        <div className={`settings-panel${tab === 'basic' ? ' active' : ''}`}>
          <GeneralSettings
            settings={settings}
            toggles={toggles}
            updateSetting={updateSetting}
            toggleSwitch={toggleSwitch}
            toggleOutputFormat={toggleOutputFormat}
            chooseOutputDir={chooseOutputDir}
            chooseImageOutputDir={chooseImageOutputDir}
          />
        </div>

        <div className={`settings-panel${tab === 'local' ? ' active' : ''}`}>
          <LocalInferenceSettings
            settings={settings}
            toggles={toggles}
            updateProvider={updateProvider}
            updateSetting={updateSetting}
            toggleSwitch={toggleSwitch}
            toggleLocalOcr={toggleLocalOcr}
            testConnection={testConnection}
            testResults={testResults}
          />
        </div>

        <div className={`settings-panel${tab === 'agent' ? ' active' : ''}`}>
          <AgentMcpSettings />
        </div>

        <div className={`settings-panel${tab === 'about' ? ' active' : ''}`}>
          <AboutView />
        </div>
      </div>
    </div>
  );
}
