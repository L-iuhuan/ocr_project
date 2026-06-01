# DocFlow UI/UX 重构方案

**状态:** 定稿 v3.0 — 与 HTML demo v4 完全对齐  
**日期:** 2026-05-31  
**目标:** 精确复现 docflow-demo-v4.html 的全部 UI 效果

---

## 1. 页面布局总图

```
┌──────────────────────────────────────────────────────────────────┐
│  Top Bar (h-48)                                                  │
│  [DF] DocFlow   任务  设置           ●●●●  [🌙/☀️/🌓]        │
│                   nav tabs           palette      theme(3态)     │
├──────┬───────────────────────────────────────────────────────────┤
│      │                                                            │
│ 左   │  Main Content                                              │
│ 侧   │  ┌────────────────────────────────────────────────────┐   │
│ 面   │  │  任务列表 · 7 个文件，3 个处理中       🔍 搜索...  │   │
│ 板   │  ├────────────────────────────────────────────────────┤   │
│      │  │  全部(7)  处理中(3)  排队中(2)  已完成(1)  失败(1) │   │
│ 固   │  ├────────────────────────────────────────────────────┤   │
│ 定   │  │  ┌─ 任务卡片 ──────────────────────────────────┐   │   │
│      │  │  │ [📄] 2024年半导体...报告.pdf     [MinerU·精度] ⏸✕│   │
│ w200  │  │  │ 📦12.4MB 📄87页 ⏱2分34秒                      │   │
│      │  │  │ ████████████████████░░░░ 62%                   │   │
│ 过   │  │  │ ✓第1-15 ✓16-30 ✓31-45 ●46-60 ○61-75 ○76-87   │   │
│ 滤   │  │  └────────────────────────────────────────────────┘   │   │
│      │  │  ┌─ 任务卡片 (部分失败) ─────────────────────────┐   │   │
│      │  │  │ [📄] 财报数据_扫描版.pdf     [MinerU·精度] ↻✕  │   │   │
│      │  │  │ 📦8.2MB 📄35页 ⏱2分01秒 67% · 1 失败          │   │
│      │  │  │ ✓第1-12 ✓13-24 ✕第25-35                       │   │   │
│      │  │  └────────────────────────────────────────────────┘   │   │
│      │  │  ┌─ 任务卡片 (排队中, 半透明) ──────────────────┐   │   │
│      │  │  │ [📝] 产品需求文档_PRD_v4.docx    [本地Ollama] ✕  │   │   │
│      │  │  │ 📦1.2MB 📄28页 ⏱—         —                     │   │
│      │  │  │ ○排队中 · 3 个分块                              │   │   │
│      │  │  └────────────────────────────────────────────────┘   │   │
│      └───────────────────────────────────────────────────────────┤
├──────┴───────────────────────────────────────────────────────────┤
│  Status Bar                                                      │
│  3 处理中  12 分块  1 失败  ⚡ 2.4秒/块   │  MinerU 45/100 │ ... │
└──────────────────────────────────────────────────────────────────┘
```

**关键布局规则（从 demo 提取）：**
- **顶栏 nav tabs** 切换任务视图和设置视图（两个 view 是互斥的，不是面板覆盖）
- **左侧面板** 是固定的任务过滤/操作面板（196px），不是可折叠的导航 Dock
- **任务视图和设置视图** 共享同一套顶栏 + 同一套左侧面板？不是。看 demo 结构：
  - 顶栏 nav tabs 切换 `#taskView` 和 `#settingsView`
  - 左侧面板（sidebar）在任务视图下是过滤面板
  - 设置视图下，main-content 内部重新布局：左侧 settings-tabs，右侧 settings-panels
  - **左侧面板在设置视图下消失**，被 settings 自己的 tab 栏替代

实际上更准确的理解：
- **任务视图：** 顶栏(含nav tab) + 左侧过滤面板(196px) + 主内容区(卡片列表)
- **设置视图：** 顶栏(含nav tab) + 主内容区(左侧设置tab + 右侧设置内容)
- 顶栏的 nav tab 是整个视图切换开关

---

## 2. 设计系统

### 2.1 调色板体系（4 套）

demo 定义了 4 套调色板，每套有 dark/light/auto 三态：

| 名称 | 强调色 | 氛围 |
|------|--------|------|
| `lavender` 淡紫 | `#9b8ec4` | 优雅、柔和（默认） |
| `amber` 琥珀 | `#c9956b` | 温暖、复古 |
| `ice` 冰蓝 | `#5b9bd5` | 冷静、专业 |
| `mint` 薄荷 | `#5cb8a2` | 清新、自然 |

**实现方式：** 在 `index.css` 中用属性选择器 `:root[data-palette="ice"]` + `[data-theme="dark/light"]` 定义完整的 CSS 变量体系。React 中通过切换 `document.documentElement` 的 `data-palette` 和 `data-theme` 属性切换。

### 2.2 主题三态

| 状态 | 显示 | 说明 |
|------|------|------|
| `dark` | 🌙 | 强制暗色 |
| `light` | ☀️ | 强制亮色 |
| `auto` | 🌓 (边框高亮) | 跟随系统 `prefers-color-scheme` |

主题按钮循环切换：`dark → light → auto → dark → ...`

### 2.3 核心 CSS 变量

```css
/* 每个 palette + theme 组合独立定义，以 ice-dark 为例 */
:root[data-palette="ice"][data-theme="dark"] {
  --bg-deep: #0a0e16;
  --bg-surface: #111620;
  --bg-sidebar: rgba(255,255,255,0.01);
  --glass-1: rgba(255,255,255,0.025);
  --glass-2: rgba(255,255,255,0.045);
  --glass-3: rgba(255,255,255,0.07);
  --glass-hover: rgba(255,255,255,0.06);
  --border-subtle: rgba(255,255,255,0.04);
  --border-glass: rgba(255,255,255,0.06);
  --border-glass-h: rgba(255,255,255,0.14);
  --text-primary: #e4e8f0;
  --text-secondary: #9aa4b8;
  --text-tertiary: #5d6678;
  --accent: #5b9bd5;
  --accent-soft: rgba(91,155,213,0.12);
  --accent-border: rgba(91,155,213,0.2);
  --accent-text: #7ebce8;
  --green: #6bb89a;
  --green-bg: rgba(107,184,154,0.1);
  --red: #c97a8a;
  --red-bg: rgba(201,122,138,0.1);
  --amber: #c9a86b;
  --amber-bg: rgba(201,168,107,0.1);
  --shadow: 0 30px 80px -20px rgba(0,0,0,0.9);
  --surface-bg: rgba(17,22,32,0.6);
  --glow: radial-gradient(ellipse, rgba(91,155,213,0.04) 0%, transparent 70%);
  --glow-2: radial-gradient(ellipse, rgba(91,155,213,0.03) 0%, transparent 70%);
  --scrollbar: rgba(255,255,255,0.05);
}
```

其他 7 个组合（ice-light、mint-dark、mint-light、lavender-dark、lavender-light、amber-dark、amber-light）同理。

### 2.4 全局效果

- **App 容器:** 圆角 20px、边框 `1px solid var(--border-subtle)`、inset 阴影
- **背景光晕:** `::before` 左上和 `::after` 右下各有一个 radial-gradient 光晕
- **玻璃拟态:** 多处使用 `backdrop-filter: blur()` + `rgba` 背景
- **滚动条:** 细（4px）、半透明

---

## 3. 组件清单（与 HTML demo 精确对齐）

### 3.1 顶栏 TopBar

**文件:** `src/components/TopBar.tsx`（新建，替换 App.tsx 内的硬编码 header）

```
┌──────────────────────────────────────────────────────────────┐
│ [DF] DocFlow   任务 │ 设置          ●lav●amb●ice●mint   🌙 │
│  logo + name    nav tabs            palette selection    theme│
└──────────────────────────────────────────────────────────────┘
```

**Props:**
```tsx
interface TopBarProps {
  activeView: 'tasks' | 'settings';
  onViewChange: (view: 'tasks' | 'settings') => void;
  palette: PaletteId;       // 'ice' | 'mint' | 'lavender' | 'amber'
  onPaletteChange: (p: PaletteId) => void;
  theme: 'dark' | 'light' | 'auto';
  onThemeChange: (t: 'dark' | 'light' | 'auto') => void;
}
```

**Palette 选择器：** 4 个彩色圆点，激活态有白色边框 + 放大。hover 时有透明度变化。

**主题按钮：** 三态循环 🌙 → ☀️ → 🌓（auto态边框高亮），全部为天体系 emoji，视觉统一。

### 3.2 左侧过滤面板 Sidebar

**文件:** `src/components/Sidebar.tsx`（新建）

```
┌──────────────────┐
│ 📄 添加文件       │ ← primary button
│ 📂 添加文件夹     │ ← secondary button
│ ▶ 全部开始        │ ← secondary button
│ ──────────────── │ ← divider
│ 📋 全部任务    (7)│ ← active
│ ⚡ 运行中         │
│ ✅ 已完成         │
│ ❌ 失败           │
│                   │
│ 📊 统计           │ ← footer (future)
└──────────────────┘
```

**Props:**
```tsx
interface SidebarProps {
  filters: TaskFilters;
  counts: { all: number; running: number; done: number; failed: number };
  onFilterChange: (filter: string) => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onStartAll: () => void;
}
```

**行为：**
- 固定宽度 196px，不折叠
- 过滤项点击高亮
- 计数徽章（全部任务 显示在右侧）
- 按钮分主次（primary 蓝底白字，secondary 玻璃底 + 边框）

### 3.3 任务卡片 TaskCard

**文件:** `src/components/TaskCard.tsx`（新建）

```
┌─────────────────────────────────────────────────────────┐
│ [📄] 2024年半导体行业深度报告_最终版.pdf       [MinerU·精度] ⏸✕│  ← row1
│ 📦 12.4 MB  📄 87 页  ⏱ 2分34秒                          │  ← meta
│ ████████████████████░░░░░░░░  62%                         │  ← prog-row
│ ✓第1-15页  ✓第16-30页  ✓第31-45页  ●第46-60页  ○...  │  ← chunks
└─────────────────────────────────────────────────────────┘
```

**Props:**
```tsx
interface TaskCardProps {
  task: Task;
  onPause?: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
  onOpenOutput?: (jobId: string) => void;
}
```

**状态变体：**
| 状态 | 视觉效果 | 操作按钮 |
|------|---------|---------|
| processing | 正常透明度 | ⏸ 暂停 + ✕ 取消 |
| done | 正常透明度，进度条绿色 | 📂 打开输出 + ✕ 移除 |
| failed | 正常透明度，进度条红色，`67% · 1 失败` 琥珀色 | ↻ 重试 + ✕ 移除 |
| queued/paused | `opacity: 0.55`，进度条灰色 | ✕ 移除 |

**文件图标区域：**
- `.pdf` → 📄 红色背景
- `.docx/.doc/.pptx/.xlsx` → 📝 强调色背景
- `.png/.jpg/.jpeg/.tiff` → 🖼 琥珀色背景
- 图标随卡片 hover 略微放大（`scale(1.05)`）

**卡片 hover 效果：**
```css
.task-card:hover {
  background: var(--glass-hover);
  border-color: var(--accent-border);
  transform: translateY(-1.5px);
  box-shadow: 0 8px 28px rgba(0,0,0,0.3), 0 0 0 1px var(--accent-border) inset;
}
```

**分块显示（chunks）：** 关键组件，精确匹配 demo

```tsx
interface ChunkPill {
  index: number;
  pageRange: string;     // "第1-15页"
  status: 'done' | 'processing' | 'queued' | 'failed' | 'extracting';
}
```

每种状态的视觉：
- `done`: `✓ 第1-15页` — 绿色背景 + 绿色文字 + 绿色边框
- `processing`: `● 第46-60页` — 蓝色背景 + 蓝色文字 + 闪烁圆点动画
- `queued`: `○ 第61-75页` — 灰色背景 + 灰色文字
- `failed`: `✕ 第25-35页` — 红色背景 + 红色文字
- `extracting`: `📦 第31-42页（提取中）` — 琥珀色背景 + 琥珀色文字

**分块动画：** processing 状态有脉冲圆点 `@keyframes pulse-dot { 0%,100%{opacity:1}50%{opacity:0.3} }`

### 3.4 任务列表 TaskList

**文件:** `src/components/TaskList.tsx`（新建）

```
┌────────────────────────────────────────────────────────────┐
│ 任务列表 · 7 个文件，3 个处理中              🔍 搜索...   │ ← main-header
├────────────────────────────────────────────────────────────┤
│ 全部(7)  处理中(3)  排队中(2)  已完成(1)  失败(1)         │ ← filter-bar
├────────────────────────────────────────────────────────────┤
│ ┌─ TaskCard ───────────────────────────────────────────┐  │
│ │ ...                                                  │  │
│ └──────────────────────────────────────────────────────┘  │
│ ┌─ TaskCard ───────────────────────────────────────────┐  │
│ │ ...                                                  │  │
│ └──────────────────────────────────────────────────────┘  │
│ ...                                                       │
│ ┌─ 空状态（无任务时显示）─────────────────────────────┐  │
│ │            📄                                         │  │
│ │    拖拽文件到此处开始处理                             │  │
│ │    支持 PDF · DOCX · PNG · JPG · 也可添加整个文件夹  │  │
│ └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Props:**
```tsx
interface TaskListProps {
  tasks: Task[];
  filter: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onFilterChange: (f: string) => void;
  // ... callbacks
}
```

**空状态：** 虚线边框、居中文字、hover 时背景变 accent 色 + 边框变 accent

**搜索框：** 🔍 icon + `<input>` 120px

**筛选芯片 (filter chips)：** 圆角药丸按钮，active 时有 accent 背景 + 边框。每个显示计数。

### 3.5 设置视图 SettingsView

**文件:** `src/components/SettingsView.tsx`（新建）

设置视图是一个独立 view，由顶栏 `nav-tab[data-view="settings"]` 切换显示。

布局：
```
┌────────────────────────────────────────────────────────────┐
│ ┌──────────┐ ┌────────────────────────────────────────┐   │
│ │ 🔌 服务商 │ │  [对应 tab 的内容面板]                   │   │
│ │ ⚙️ 基本设置│ │                                        │   │
│ │ 💻 本地推理│ │  [可滚动]                              │   │
│ └──────────┘ └────────────────────────────────────────┘   │
│                                                        │
│  settings-tabs (140px)     settings-panels (flex:1)    │
└────────────────────────────────────────────────────────────┘
```

**SettingsTab 组件（左侧 tab 栏）：** 竖排、带图标、active 时 accent 背景 + 边框

### 3.6 服务商设置（SettingsTab 1）

**文件:** `src/components/panels/ProviderSettings.tsx`（新建）

#### 服务商优先级列表

```
┌──────────────────────────────────────────────────────────┐
│ 服务商优先级                                               │
│ 拖拽调整顺序 · 排在前面的优先使用 · 配额用尽后自动切换      │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ⠿ ① MinerU Cloud        ● 在线 · 45/100 今日  ▾    │ │  ← prio-item
│ │ ┌────────────────────────────────────────────────┐  │ │  ← provider-config (expand)
│ │ │ 接口地址: [https://mineru.net/api/v4       ]  │  │ │
│ │ │ API Token: [••••••••••••••••••••••••    ]  │  │ │
│ │ │ 处理模式: [精度模式(Precision v4) ▾       ]  │  │ │
│ │ │ 额外识别: ☑ 扫描件OCR ☑ 公式识别 ☑ 表格识别  │  │ │
│ │ └────────────────────────────────────────────────┘  │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ ⠿ ② PaddleOCR Cloud     ● 在线 · 无限配额      ▾    │ │
│ │ ┌─ config ───────────────────────────────────────┐  │ │
│ │ │ 接口地址: [https://paddleocr.ai/api        ]  │  │ │
│ │ │ Access Token: [••••••••••••••••••••••••  ]  │  │ │
│ │ └────────────────────────────────────────────────┘  │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ ⠿ ③ 本地推理(Ollama)     ● 本地 · llama3.2-vision ▾ │ │
│ │ ┌─ config ───────────────────────────────────────┐  │ │
│ │ │ 服务器地址: [http://localhost:11434] [测试连接] │  │ │
│ │ │ 模型名称: [llama3.2-vision:11b ▾]   [拉取模型] │  │ │
│ │ └────────────────────────────────────────────────┘  │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ ⠿ ④ LocalAI              ✕ 离线               ▾    │ │
│ │ ┌─ config ───────────────────────────────────────┐  │ │
│ │ │ ...                                            │  │ │
│ │ └────────────────────────────────────────────────┘  │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**实现要点：**
- 每行 `prio-item` 可点击展开/折叠下方 `provider-config`
- 拖拽排序用 HTML5 DnD（`⠿` 为拖拽手柄）
- 展开箭头 `▾` 带 `rotate(180deg)` 过渡
- 状态标签 `pstatus.on`（绿色）/ `pstatus.off`（红色）/ `pstatus.local`（琥珀色）
- 每个服务商的可配置项见 demo 精确字段：
  - MinerU: 接口地址、API Token、处理模式（下拉）、额外识别选项（复选框组）
  - PaddleOCR: 接口地址、Access Token
  - Ollama: 服务器地址、测试连接按钮、模型名称下拉、拉取模型按钮
  - LocalAI: 服务器地址、测试连接、模型名称输入（半透明表示离线）

### 3.7 基本设置（SettingsTab 2）

**文件:** `src/components/panels/GeneralSettings.tsx`（新建）

#### 输出设置
```
┌──────────────────────────────────────────────────────────┐
│ 输出设置                                                   │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 输出格式          ☑ Markdown ☐ 纯文本 ☐ HTML ☐ JSON │ │
│ │ 输出目录          [./output/              ] [浏览]    │ │
│ │ 文件命名模板      [{name}_processed_{date}      ]    │ │
│ │                   [{name} {date} {time} {timestamp}] │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**命名模板：** 输入框 + 可点击变量芯片。点击芯片在光标位置插入变量。
变量：`{name}`（原名）`{date}`（日期）`{time}`（时间）`{timestamp}`（时间戳）

#### 并发处理
```
┌──────────────────────────────────────────────────────────┐
│ 并发处理                                                   │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 最大并行文件数    ├───●───────┤ 3                     │ │
│ │ 每文件并行分块数  ├─────●─────┤ 3                     │ │
│ │ 分块大小         [15页 ▾]                             │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- 最大并行文件数：slider 1-8，默认 3
- 每文件并行分块数：slider 1-6，默认 3
- 分块大小：下拉 5/10/15/20 页，默认 15

#### 后处理
```
┌──────────────────────────────────────────────────────────┐
│ 后处理                                                    │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 自动解压 ZIP 结果                  [🔘]              │ │
│ │ 合并后删除分块临时文件            [🔘]              │ │
│ │ 删除原始 ZIP                      [🔘]              │ │
│ │ 保留识别到的图片                  [🔘]              │ │
│ │ 图片保存路径                      [./output/images/] │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

toggle 开关：圆角矩形 + 圆形 knob，on 状态 accent 色。

### 3.8 本地推理（SettingsTab 3）

**文件:** `src/components/panels/LocalInferenceSettings.tsx`（新建）

#### 本地推理优先级
```
┌──────────────────────────────────────────────────────────┐
│ 本地推理优先级                                             │
│ 本地处理时，优先使用哪个引擎进行文档解析                    │
│ ○ OCR引擎优先 — 精度高，适合纯文字文档                      │
│ ● 视觉模型优先 — 理解版式，适合图文混排                    │
└──────────────────────────────────────────────────────────┘
```

#### 本地 OCR 引擎
```
┌──────────────────────────────────────────────────────────┐
│ 本地 OCR 引擎                                              │
│ 通过 Python 子进程调用 PaddleOCR，纯本地运行，不上传文件    │
│ 启用                           [🔘]                      │
│ Python 路径                    [python               ]   │
└──────────────────────────────────────────────────────────┘
```

#### 视觉大模型（OpenAI 兼容协议）
```
┌──────────────────────────────────────────────────────────┐
│ 视觉大模型（OpenAI 兼容协议）                              │
│ 适用于 Ollama、LM Studio、llama.cpp、vLLM 等               │
│                                                          │
│ ┌─ Ollama ──────────────────────────────────────────┐   │
│ │ Ollama                               [🔘]        │   │
│ │ │ 服务地址: [http://localhost:11434] [测试连接]    │   │
│ │ │ 视觉模型: [llama3.2-vision:11b ▾]   [拉取模型]  │   │
│ └────────────────────────────────────────────────────┘   │
│                                                          │
│ ┌─ 其他 OpenAI 兼容服务 ────────────────────────────┐   │
│ │ 其他 OpenAI 兼容服务                   [🔘]        │   │
│ │ │ 类型: [自定义 OpenAI 兼容 ▾]                     │   │
│ │ │ 服务地址: [http://localhost:1234]  [测试连接]     │   │
│ │ │ 模型名称: [                          ]           │   │
│ └────────────────────────────────────────────────────┘   │
│                                                          │
│ ┌─ 本地部署的专业服务 ──────────────────────────────┐   │
│ │ 本地部署的专业服务                     [🔘]        │   │
│ │ │ 协议类型: [MinerU 本地服务 ▾]                    │   │
│ │ │ 服务地址: [http://localhost:8000]  [测试连接]     │   │
│ └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

**实现要点：**
- 每个服务是一个 `card`，标题行加粗 + toggle 开关
- 配置区域通过 `section-indent`（左边框缩进）区分层级
- toggle 开关独立控制各服务的启用状态
- 测试连接按钮：idle / loading / success / fail 四种状态

### 3.9 状态栏 StatusBar

**文件:** `src/components/StatusBar.tsx`（重构）

```
┌──────────────────────────────────────────────────────────────────┐
│ ● 3 处理中  ● 12 分块  ● 1 失败  ⚡ 平均 2.4秒/块              │
│                                          │ MinerU 45/100 │ ...  │
│  left: queue metrics                     │ right: provider quotas│
└──────────────────────────────────────────────────────────────────┘
```

**左侧指标：**
- 处理中计数（绿点）
- 分块计数（蓝点）
- 失败计数（红点）
- 平均处理速度（⚡ x秒/块）

**右侧服务商配额：**
- 每个已配置的服务商一行：名称 + 配额数值
- MinerU: `45/100`（强调色）
- PaddleOCR: `无限`（绿色）
- Ollama: `本地`（琥珀色）
- 分隔符 `│`

**未显示：** 当没有任务时，整个状态栏隐藏或只显示版本号。

### 3.10 拖拽覆盖层 DragOverlay

**文件:** 内联在 `App.tsx` 或独立的 `DragOverlay.tsx`

- 全 app 范围监听 `dragenter/dragover/dragleave/drop`
- 覆盖层：`position:absolute;inset:0`，`backdrop-filter:blur(4px)`，虚线边框
- 文字：`📄 释放文件以添加到任务列表`
- 放下后短暂显示 `✅ 已添加 N 个文件`（1.5秒后自动消失）
- demo 中使用原生 JS 实现，React 中同理

---

## 4. 分块级任务追踪与失败处理（核心需求）

### 4.1 分块模型

```ts
interface TaskChunk {
  id: string;               // 唯一标识
  index: number;            // 分块序号（0-based）
  pageRange: string;        // "第1-15页"
  pageStart: number;        // 起始页
  pageEnd: number;          // 结束页
  status: 'queued' | 'processing' | 'extracting' | 'done' | 'failed';
  error?: string;           // 失败时的错误信息
  retryCount: number;       // 已重试次数
  maxRetries: number;       // 最大重试次数（可配置）
  provider?: string;        // 处理此分块的服务商
  startedAt?: number;       // 开始时间
  completedAt?: number;     // 完成时间
  result?: ChunkResult;     // 处理结果
}

interface Task {
  jobId: string;
  originalName: string;
  fileType: string;
  fileSize: number;      // bytes
  pageCount: number;
  chunks: TaskChunk[];    // 分块列表
  status: TaskStatus;     // 'pending' | 'processing' | 'done' | 'failed' | 'cancelled'
  progress: number;       // 0-100 (based on chunks done/total)
  createdAt: number;
  elapsed: number;        // 已用时间（秒）
  providerUsed: string;
}
```

### 4.2 分块级失败处理策略

#### 场景 A：大文件分块，部分块失败

一个 87 页文件分成 6 个分块：
- ✓ 第1-15页（done）
- ✓ 第16-30页（done）
- ✓ 第31-45页（done）
- ● 第46-60页（processing）
- ○ 第61-75页（queued）
- ✕ 第76-87页（failed — 配额超限）

**处理流程：**
1. 失败的分块 `第76-87页` 自动重新排队（retryCount < maxRetries 时）
2. 如果重试仍失败，标记为 `failed`，记录具体错误原因
3. 任务整体显示 `67% · 1 失败`（琥珀色警告，非红色错误）
4. 用户可对单个失败分块右键/点击重试，也可对整个任务重试（仅重试失败分块）

#### 场景 B：整个文件解析失败

一个 35 页文件，第 3 个分块连续重试 3 次均失败（如服务端返回 500）。

**处理流程：**
1. 已有成功分块（第1-12、13-24页）保留
2. 任务整体标记为 `failed`
3. 错误信息指向失败分块的具体原因："第25-35页：MinerU 服务端错误（HTTP 500），已重试 3 次"
4. 用户可点击 `↻` 重试整个任务（仅重试失败分块）

#### 场景 C：轻量化失败 — 只给失败名单

一个 200 页文件同时分发到多个服务商，其中 PaddleOCR 处理的某些分块失败。

**处理流程：**
1. 不自动重试（失败原因明确：Token 过期/配额耗尽）
2. 在任务卡片中清晰列出失败分块：
   ```
   ✕ 第76-100页（PaddleOCR — 今日配额已用完）
   ✕ 第101-125页（PaddleOCR — 今日配额已用完）
   ```
3. 状态栏显示失败计数
4. 用户可一键重新排队所有失败分块（会自动走路由选择其他服务商）

### 4.3 重试逻辑

```ts
async function retryFailedChunks(task: Task): Promise<void> {
  const failedChunks = task.chunks.filter(c => c.status === 'failed');

  for (const chunk of failedChunks) {
    chunk.status = 'queued';
    chunk.retryCount++;
    chunk.error = undefined;
  }

  // 重新进入队列，路由会自动选择可用服务商
  await enqueueChunks(task.jobId, failedChunks);
}

// 也支持批量重试：用户可从失败过滤视图中选择多个任务一键重试
async function batchRetryFailedTasks(jobIds: string[]): Promise<void> {
  for (const id of jobIds) {
    const task = getTask(id);
    if (task) await retryFailedChunks(task);
  }
}
```

### 4.4 UI 中的失败呈现

| 层级 | 位置 | 显示内容 |
|------|------|---------|
| 分块 | chunk pill | `✕ 第25-35页`（红色）+ hover tooltip 显示错误原因 |
| 任务 | 进度条下方 | `67% · 1 失败`（琥珀色，非红色——因为部分成功） |
| 任务 | 进度条 | 红色填充到失败位置（显示到哪失败的） |
| 汇总 | 状态栏 | `● 1 失败`（红点） |
| 侧栏 | 过滤 | 「失败」分类显示失败任务数 |
| 批量 | 设置视图 | 失败任务清单列表（未来功能） |

---

## 5. 文件变动总图

```
src/
├── App.tsx                          # 重写：整体布局，view 切换
├── main.tsx                         # 不变
├── index.css                        # 重写：4 套调色板 × 2 主题 = 8 组 CSS 变量 + 全局样式

├── components/
│   ├── TopBar.tsx                   # 新建：nav tabs + 调色板 + 主题
│   ├── Sidebar.tsx                  # 新建：文件操作 + 任务过滤（固定 196px）
│   ├── TaskCard.tsx                 # 新建：分块级卡片 + 5 种状态
│   ├── TaskList.tsx                 # 新建：标题 + 搜索 + filter chips + 卡片列表
│   ├── TaskTable.tsx                # 删除（被 TaskCard + TaskList 替代）
│   ├── ChunkPill.tsx                # 新建：分块标签组件（done/proc/queued/fail）
│   ├── StatusBar.tsx                # 重写：队列指标 + 服务商配额
│   ├── DragOverlay.tsx              # 新建：全应用拖拽覆盖层
│   │
│   ├── SettingsView.tsx             # 新建：设置视图编排（左侧 tab + 右侧面板）
│   ├── settings/
│   │   ├── ProviderSettings.tsx     # 新建：服务商优先级 + 展开配置
│   │   ├── ProviderCard.tsx         # 新建：单个服务商配置卡片
│   │   ├── GeneralSettings.tsx      # 新建：输出/并发/后处理设置
│   │   ├── LocalInferenceSettings.tsx # 新建：本地推理完整配置
│   │   └── Toggle.tsx               # 新建：滑动开关组件
│   │
│   ├── PaletteSelector.tsx          # 新建：4 色调色板选择器
│   └── ThemeToggle.tsx              # 新建：3 态主题切换

├── hooks/
│   └── useSettings.ts              # 新建：设置加载/保存
│   └── useTheme.ts                 # 新建：主题 + 调色板管理

└── types/
    └── index.ts                    # 新建：Task、TaskChunk、Settings 等类型
```

---

## 6. 实现顺序

### 第 1 批（基础框架 + 类型系统）
| 步骤 | 内容 |
|------|------|
| 1.1 | `src/types/index.ts` 定义所有 TypeScript 类型（Task、TaskChunk、Settings、Provider 等） |
| 1.2 | `index.css` 写入全部 8 组 CSS 变量 + 全局样式（复制自 demo v4） |
| 1.3 | `useTheme.ts` hook（data-palette + data-theme 切换逻辑） |

### 第 2 批（整体布局 + 导航视图）
| 步骤 | 内容 | 依赖 |
|------|------|------|
| 2.1 | `TopBar.tsx` + `PaletteSelector.tsx` + `ThemeToggle.tsx` | 1.3 |
| 2.2 | `Sidebar.tsx`（固定 196px 过滤面板） | 1.1 |
| 2.3 | 重写 `App.tsx`（整合 TopBar + Sidebar + view 切换） | 2.1, 2.2 |

### 第 3 批（任务视图）
| 步骤 | 内容 | 依赖 |
|------|------|------|
| 3.1 | `ChunkPill.tsx`（5 种状态 + 动画） | 1.1 |
| 3.2 | `TaskCard.tsx`（卡片 + 进度条 + 分块行 + 4 种变体） | 3.1 |
| 3.3 | `TaskList.tsx`（搜索 + filter chips + 卡片列表 + 空状态） | 3.2 |
| 3.4 | `StatusBar.tsx`（队列指标 + 服务商配额） | 1.1 |
| 3.5 | `DragOverlay.tsx`（全应用拖拽） | 2.3 |

### 第 4 批（设置视图 — 可与第 3 批并行）
| 步骤 | 内容 | 依赖 |
|------|------|------|
| 4.1 | `useSettings.ts` hook | 1.1 |
| 4.2 | `Toggle.tsx` 滑动开关 | 1.2 |
| 4.3 | `ProviderCard.tsx` + `ProviderSettings.tsx`（含拖拽排序） | 1.1, 4.2 |
| 4.4 | `GeneralSettings.tsx`（输出/并发/后处理） | 4.2 |
| 4.5 | `LocalInferenceSettings.tsx`（本地推理完整配置） | 4.2 |
| 4.6 | `SettingsView.tsx`（tab 编排 + view 集成） | 4.3, 4.4, 4.5 |

### 第 5 批（分块级任务引擎 — 核心逻辑）
| 步骤 | 内容 | 依赖 |
|------|------|------|
| 5.1 | 分块拆分逻辑（按 pageSize 拆分 TaskChunk[]） | 1.1 |
| 5.2 | 分块调度器（排队 + 并发控制 + 背压） | 5.1 |
| 5.3 | 分块级失败处理（重试、失败列表、部分成功合并） | 5.2 |
| 5.4 | 批量重试接口（单任务/多任务失败分块重试） | 5.3 |

### 第 6 批（后处理增强 — 低优先级）
| 步骤 | 内容 |
|------|------|
| 6.1 | 多格式输出（目前 MD 可用，新增 TXT/HTML/JSON） |
| 6.2 | 文件命名模板解析 |
| 6.3 | ZIP 自动解压 + 临时文件清理 |

---

## 7. 关键组件 Props 定义

### App.tsx（伪代码）

```tsx
function App() {
  const [activeView, setActiveView] = useState<'tasks' | 'settings'>('tasks');
  const [palette, setPalette] = useState<PaletteId>('lavender');
  const [theme, setTheme] = useState<'dark' | 'light' | 'auto'>('dark');
  const [taskFilter, setTaskFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="app">
      <DragOverlay onDrop={handleDropFiles} />
      <TopBar { ...topBarProps } />
      <div className="app-body">
        {activeView === 'tasks' ? (
          <>
            <Sidebar { ...sidebarProps } />
            <main className="main-content">
              <TaskList { ...taskListProps } />
            </main>
          </>
        ) : (
          <main className="main-content">
            <SettingsView />
          </main>
        )}
      </div>
      <StatusBar { ...statusBarProps } />
    </div>
  );
}
```

### TaskCard Props

```tsx
interface TaskCardProps {
  task: Task;
  onPause?: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
  onOpenOutput?: (jobId: string) => void;
  onChunkRetry?: (jobId: string, chunkId: string) => void;
}
```

### ChunkPill Props

```tsx
interface ChunkPillProps {
  chunk: TaskChunk;
  onClick?: (chunkId: string) => void;  // 点击查看详情/重试
}
```

---

## 8. 设计决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | 用属性选择器 `[data-palette][data-theme]` 切换主题，而非 Tailwind `dark:` | 4 套调色板 × 2 主题 = 8 种组合，Tailwind 的 `dark:` 前缀只能处理 2 种 |
| 2 | 左侧面板固定 196px，不折叠 | demo 如此设计——过滤面板始终可见 |
| 3 | 设置视图替换而非覆盖 | demo 用 nav tab 切换视图，非 slide-in 面板 |
| 4 | 分块拆分粒度可在设置中配置（5/10/15/20 页） | demo 基本设置中有分块大小下拉 |
| 5 | 不使用 framer-motion | 全部动画用 CSS transition + keyframes 即可，减少依赖 |
| 6 | 服务商配置展开/折叠用纯 CSS + 类切换 | 不需要 JS 动画库，transition 足够 |
| 7 | 调色板不持久化到配置文件（只当前 session） | demo 没有保存调色板选择，可后续添加 |
| 8 | Shadow DOM / CSS-in-JS 都不需要 | 全部用 CSS 变量 + Tailwind 工具类 |
