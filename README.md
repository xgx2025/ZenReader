# ZenReader · 禅阅读

「阅·见本心」—— 一个极简、本地优先的 Markdown 阅读应用。做减法、沉浸心流、慢思考，无社交、无广告、无排行。

本仓库当前实现的是 **首版（MVP）**：**Markdown 导入 → 禅意阅读 → 觉悟笔记** 的完整闭环，全本地运行、无需后端、无需云同步。

## 功能

- **引卷 / 拾整卷**：拖拽或选择导入单个 `.md` 文件，或整个文件夹（书库，含目录树）。
- **书库**：网格展示、搜索、按文件夹/最近/标题筛选排序、字数与阅读时长。
- **禅意阅读**：纸墨质感排版（宣纸白 / 墨黑 / 竹青 / 檀棕 / 暮云灰，禁用纯黑白）、字号/主题（浅·暖·暗）/字体切换、目录、禅境模式（一键隐去全部 UI，Esc 返回）、代码块语法高亮。
- **觉悟笔记**：选中文本「驻足」或「写下觉悟」，用你自己的话重述；笔记持久化，刷新后高亮与笔记均保留。

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

> 前端代码可无损包进 Tauri 转为原生桌面应用（后续阶段可选路径）。

## 运行

```bash
npm install
npm run dev        # 打开 http://localhost:5173
```

> 必须通过 `http://localhost` 访问（`crypto.randomUUID()` 需安全上下文；`file://` 会失败）。

其他脚本：

```bash
npm run type-check # vue-tsc 类型检查
npm run build      # 生产构建
npm run test:unit  # Vitest（预留）
```

## 目录结构

```
src/
├── assets/styles/        # Tailwind 入口 + @theme token + .zen-prose 排版
├── types/                # Document / Note / Settings / Import
├── lib/
│   ├── db/               # Dexie schema + repo（documents / notes）
│   ├── markdown/         # parser / frontmatter / structure / highlight / sanitize
│   └── anchor/textAnchor.ts  # 选区捕获 + 高亮还原（框架无关）
├── stores/               # library / reader / notes / settings
├── composables/          # useFileImport / useSelectionAnchor / useLiveQuery
├── components/           # common / library / reader / notes
└── views/                # LibraryView / ImportView / ReaderView
```

## 核心设计

- **锚点策略**：划线笔记用「文本 + 上下文 + 出现次数」锚定渲染后的纯文本，因渲染确定（同配置同缓存 → 同 `textContent`），高亮可跨刷新稳定还原。
- **设计 token**：五色低饱和自然色，禁用 `#000` / `#fff`；手绘线稿图标；诗意文案（设置→调适、收藏→驻足、删除→释怀、导入→引卷、笔记→觉悟、禅模式→禅境）。

## 路线图（后续阶段）

WebGL 纸张纹理、白噪音、EPUB/PDF、云同步、AI 摘要、本地字体自托管、Shiki 细粒度按语言分包。
