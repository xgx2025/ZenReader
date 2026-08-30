# ZenReader · 禅阅读

「阅·见本心」—— 一个极简、本地优先的 Markdown 阅读应用。做减法、沉浸心流、慢思考，无社交、无广告、无排行。

本仓库实现的是 **首版（MVP）**：**Markdown 导入 → 禅意阅读 → 觉悟笔记** 的完整闭环，全本地运行、无需后端、无需云同步。可选装 **Tauri 桌面壳** 以读写本地文件夹。

## 功能

- **引卷 / 拾整卷**：拖拽或选择导入单个 `.md` 文件，或整个文件夹（书库，含目录树）。
- **本地文件夹读写（桌面端）**：从本地文件夹加载（原生选文件夹、直接读盘），或把导入的内容**保存到指定文件夹**（写回磁盘）。
- **书库**：网格展示、搜索、按文件夹/最近/标题筛选排序、字数与阅读时长。
- **禅意阅读**：纸墨质感排版（宣纸白 / 墨黑 / 竹青 / 檀棕 / 暮云灰，禁用纯黑白）、字号/主题（浅·暖·暗）/字体切换、段首缩进与两端对齐（还原纸质书密排）、目录（滚动追踪高亮当前章节）、工具栏随滚动智能隐现、键盘阅读流（`j`/`k` 滚动、`空格` 翻页、`←`/`→` 章节跳转、`t` 目录、`n` 笔记、`z` 禅境）、禅境模式（一键隐去全部 UI，Esc 返回）、代码块语法高亮。
- **呼吸入定（禅境仪式）**：进入禅境不是过场动画，而是一场三次呼吸的小仪式——纸纱先起，呼吸圆随「吸／呼」涨缩，**每次呼气世界真实地退去一层**（顶栏化去 → 面板隐去边距舒展 → 氛围光起正文澄明）；一声入定钵（WebAudio 合成，可关）随之轻响；轻触任意处随时跳过，Esc 随时出定（设置中可关，关闭后为快速过场）。
- **觉悟笔记**：选中文本「驻足」或「写下觉悟」，用你自己的话重述；笔记持久化，刷新后高亮与笔记均保留。
- **阅读进度与续读**：滚动位置按文档自动记忆（localStorage，防抖持久化，按内容 hash 失效）；重开时自动回到上次读处并轻提示「接着上次」；顶部一线竹青进度条（禅境中亦在）；书库卡片显示「读到 xx%」与「已读毕」，移动文件时进度随迁。
- **禅钟（定时提醒）**：进阅读页后亲手「点香」开始计时，一炷香尽轻声提醒歇息（散行 / 饮水 / 望远 / 静息轮换，香长与钟音可调）；「心流觉察」只累计真正连续专注的时间——离席或久未操作会自动熄香，提醒从不在刚休息回来时打扰；香将尽时燃香预提示、香尽颂钵钟音（WebAudio 合成）、禅境下迷你香常随。
- **禅境活气**：入定之后，纸色之上浮起一层几乎察觉不到的缓漂粒子——明亮 / 暮色是光里浮埃，夜读化作萤火明灭（canvas，十余粒，入定方起、退定即歇；`prefers-reduced-motion` 下仅一帧静尘）。

## 技术栈

纯前端 SPA，无后端、无云：

| 层 | 选择 |
|---|---|
| 框架 | Vue 3 (Composition API) + TypeScript + Vite |
| 样式 | Tailwind CSS 4（`@theme` 设计 token，CSS-first） |
| 路由 / 状态 | Vue Router 4 + Pinia |
| 本地存储 | IndexedDB（Dexie 4），`liveQuery` 响应式书库 |
| Markdown | markdown-it（GFM + 脚注 + 任务列表）+ js-yaml（frontmatter）+ DOMPurify（消毒） |
| 代码高亮 | Shiki（懒加载，按需加载语言） |
| 桌面壳（可选） | Tauri 2 + Rust（`src-tauri/`），原生文件夹读写 |

## 运行

### 浏览器模式（无需工具链）

```bash
npm install
npm run dev        # 打开 http://localhost:5173
```

> 必须通过 `http://localhost` 访问（`crypto.randomUUID()` 需安全上下文；`file://` 会失败）。

### 桌面模式（Tauri，支持本地文件夹读写）

需先安装 [Rust](https://rustup.rs) 与 **Visual Studio 2022 Build Tools**（C++ 工作负载，需管理员）：

```powershell
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
```

```bash
npm run tauri dev   # 编译 Rust 后端并启动桌面窗口
npm run tauri build # 打包发行版
```

其他脚本：

```bash
npm run type-check # vue-tsc 类型检查
npm run build      # 前端生产构建
npm run test:unit  # Vitest（预留）
```

## 目录结构

```
src-tauri/               # Tauri 桌面壳（Rust）
├── src/lib.rs           # pick_folder / read_vault / read_file / write_file 命令
└── tauri.conf.json
src/
├── assets/styles/        # Tailwind 入口 + @theme token + .zen-prose 排版
├── types/                # Document / Note / Settings / Import
├── lib/
│   ├── db/               # Dexie schema + repo（documents / notes）
│   ├── markdown/         # parser / frontmatter / structure / highlight / sanitize
│   ├── anchor/textAnchor.ts  # 选区捕获 + 高亮还原（框架无关）
│   └── native.ts         # Tauri 检测 + 文件系统命令封装
├── stores/               # library / reader / notes / settings
├── composables/          # useFileImport / useSelectionAnchor / useLiveQuery
├── components/           # common / library / reader / notes
└── views/                # LibraryView / ImportView / ReaderView
```

## 核心设计

- **锚点策略**：划线笔记用「文本 + 上下文 + 出现次数」锚定渲染后的纯文本，因渲染确定（同配置同缓存 → 同 `textContent`），高亮可跨刷新稳定还原。
- **设计 token**：五色低饱和自然色，禁用 `#000` / `#fff`；手绘线稿图标；诗意文案（设置→调适、收藏→驻足、删除→释怀、导入→引卷、笔记→觉悟、禅模式→禅境）。
- **双模式**：前端用 `isTauri()` 检测运行环境——桌面端走 Rust 文件系统命令，浏览器端回退到 Web File API，同一套代码两种形态。

## 路线图（后续阶段）

WebGL 纸张纹理、白噪音、EPUB/PDF、云同步、AI 摘要、本地字体自托管、Shiki 细粒度按语言分包、文件夹实时监听（watcher，自动同步磁盘变化）。
