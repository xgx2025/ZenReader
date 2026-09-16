# UI 预览台（浏览器里看真实界面）

ZenReader 是 Tauri 应用：`isTauri()` 为真、所有数据都从 `__TAURI_INTERNALS__.invoke`
走 Rust 命令。所以在浏览器里打开 vite dev 只会停在「尚未打开书库」——界面没法看、
更没法量。

这套工具把原生层换成替身，于是**真实组件**可以在无头 Chrome 里渲染、截图、量盒。
它只服务本地开发与视觉回归，不参与构建（所以没放在 `public/`，那里会被拷进 `dist/`）。

## 起法

```powershell
# 1) 桩服务（5299）
node tools/ui-preview/serve.mjs

# 2) vite dev（5173 被占时换端口，记得给下面的 --url）
npx vite --port 5199 --strictPort --host 127.0.0.1

# 3) 截图 / 量盒
node tools/ui-preview/shot.mjs tmp/sidebar.png --w=1280 --h=880 --scale=3 `
  --wait=9000 --clip=0,0,300,760 --url=http://127.0.0.1:5199/

node tools/ui-preview/measure.mjs --url=http://127.0.0.1:5199/
```

> 无头 Chrome 要开 Mojo 具名管道，受限沙箱下会 EPERM——这两条命令需要放宽文件权限执行。
> 桩里那份假书库要索引 60+ 篇，`--wait` 实测得给到 5s 以上，否则截到的是索引中的中间态
> （表现为折页点了不展开）。

## 可预置的状态

| 选项 | 作用 |
|---|---|
| `--theme=light\|sepia\|dark` | 三套主题各截一张 |
| `--expanded='{"MySQL/日志":false}'` | 预置侧栏展开态，直接截到深层的树 |
| `--script="…"` | 截图前在页面里跑一段表达式；可 `import('/tools/ui-preview/xxx.mjs')` 复用 |

## 现成的场景脚本

`--script="import('/tools/ui-preview/<名字>.mjs').then(m => m.default())"`：

| 脚本 | 验什么 |
|---|---|
| `scenario-rename.mjs` | 行内改名：菜单入口、输入框初值、非法名与同级重名的即时提示、提交后的落盘结果 |
| `scenario-drag.mjs` | 拖拽排序与拖拽移动：合成 `DragEvent`（带 `dataTransfer` 替身）走三态落点，并验「移进自己子树」被拒 |

两个都返回结构化结果（`script → {...}`），可直接当断言读。预览桩里的书库是**可变的**
——`rename_dir` 会真的改那份仿真清单，所以改名/搬家之后能看到落盘的样子，而不是刷新即复原。

## 分组拖动：四条命令，四种判据

| 命令 | 环境 | 能回答什么 |
|---|---|---|
| `npx vitest run src/lib/folderDrag.test.ts` | jsdom | 落点判定本身（行内分区、缝隙归位、跨层/同层/no-op） |
| `npx vitest run src/views/LibraryView.dragOrder.test.ts` | jsdom | 指针手势 → `folderOrder` → 重排这条**接线** |
| `node tools/ui-preview/preview-group-probe.mjs --from=Java --to=Redis --at=2` | 预览站 + Chrome | 真实手势下的落点几何（改判定后快速自查） |
| `node tools/ui-preview/app-drag-stability.mjs --runs=6` | **打包好的桌面端**（WebView2） | 连做 N 手会不会丢——**唯一能证明"不再丢"的** |
| `node tools/ui-preview/app-grab-probe.mjs --runs=2` | 同上 | 一行分三处（折页槽 / 名称 / ⋯）抓，抓哪儿都拿得起来吗 |
| `node tools/ui-preview/app-click-probe.mjs` | 同上 | 折页还点得开吗（真实鼠标点两次，看行数增→减）。**指针捕获吃掉 click 这类回归只有它测得到** |

`--at` 是占目标行高的十分之几（1~9）：<3 上缘、3~7 行内、>7 下缘；深层分组加
`--parent=MySQL`（会自动点开它的折页）。

分组拖动自 2026-09-16 起是**指针事件**（`useFolderDrag`），不再是 HTML5 拖放；
`app-probe.mjs` 用的 CDP 鼠标手势对两者都有效，但它报的拖放事件计数只对旧实现有意义
（现在恒为 0），判定要看「拖拽中」那行的 `body`/`hint` 与「行序」。

真机探针的两个坑：

- **单次成功不算数**。HTML5 时代同一手势的 drop 会在 0/1 之间跳（`doc/sidebar-ux.md`
  第六轮），所以判据是「连做 N 手丢了几手」——`app-drag-stability.mjs` 就是为此写的。
- **`--trace=1` 会改变结果**。装上页面内的捕获监听器本身就让「原本会丢的那次」不再丢，
  所以 trace 只用于看序列，判据一律用裸跑。

## 合成事件验不了的：原生手势协议

`scenario-drag.mjs` 走合成事件，因此**只能验落点逻辑**。真实手势（原生拖放状态机、
指针捕获、指针在元素边界间的抖动）只有 CDP `Input` 域走得到：

```powershell
node tools/ui-preview/drag-probe.mjs            # 预览站：真实手势 + 页内对照组（HTML5 拖放时代留下的）
node tools/ui-preview/app-drag-stability.mjs    # 真机：同一手势连做 N 手，看丢不丢
```

判读（`drag-probe.mjs`）：应用侧 `drop` 应为 `1`。若 `over` 不为 0 而 `drop` 为 0、
`leave` 成串，就是落点边界抖动；末尾 `control` 行的 `drop=1`（页面上最朴素的
`draggable/drop`）说明环境本身能派发 `drop`。`gesture.mjs` 是可复用的手势模块（CDP `Input` 域）。

## 三条对齐判据

侧栏（`w-56` = 224px）的版面契约，改完再量一次即可验：

| 判据 | 期望 |
|---|---|
| 书库标题 / 区带标题 / 顶层分组名的 `x` | 三者相等（本机 44） |
| 任意深度分组的 `.folder-tail` 右缘 | 全部相等（本机 204） |
| 折页与书架图标的水平中心 | 相等（本机 29） |

`measure.mjs` 末尾会把这三条直接打出来。
