/**
 * 书库预览桩：让 vite dev 在**浏览器**里渲染出真实侧栏。
 *
 * 应用是 Tauri 专属（`isTauri()` + `__TAURI_INTERNALS__.invoke` 全部指向 Rust），
 * 浏览器里打开只会停在「尚未打开书库」。这里把原生层替身装上，喂一份仿真书库，
 * 于是 UI 可以在无头 Chrome 里被截图、被量盒——「别扭」才有机会落成数字。
 *
 * 只服务本地开发与视觉回归，**不要**把这个文件放进 public/（那会进产物）。
 * 用法见 tools/ui-preview/README.md。
 */
;(function () {
  var STUB_BASE = 'http://127.0.0.1:5299'

  window.isTauri = true

  var settings = {
    theme: 'light',
    fontSize: 16,
    lineHeight: 1.95,
    textWidth: 56,
    fontFamily: 'serif',
    paragraphIndent: false,
    justify: false,
    zenMode: false,
    zenEntry: 'mist',
    immersiveFullscreen: true,
    paperTexture: 'off',
    reminder: {
      enabled: true,
      intervalMinutes: 45,
      actions: ['stretch', 'water', 'eyes', 'breathe'],
      preHint: true,
      chime: true,
    },
    vaultPath: 'D:\\Documents\\My Knowledge',
    sidebarWidth: 224,
  }

  /**
   * 仿真的书库清单。形状与 Rust `read_vault` 一致：`dirs` 是相对书库根的
   * `/` 分隔路径（含空目录），`files[].relativePath` 同理。
   *
   * 数据刻意混了长短名字、空分组、深一层子分组与两种卷式，好把侧栏的截断、
   * 0 卷降档、缩进、双计数一次照亮。
   *
   * **可变**：rename_dir / notes_rename_folder 会真的改这份表，于是改名、拖动排序、
   * 拖拽移动都能在预览里看到落盘之后的样子（否则刷新一次就复原，等于没验）。
   */
  var folders = [
    ['agent', 4, []],
    ['Java', 9, []],
    ['MySQL', 2, ['MySQL/WAL机制', 'MySQL/日志', 'MySQL/索引', 'MySQL/锁']],
    ['MySQL/WAL机制', 8, []],
    ['MySQL/日志', 5, []],
    ['MySQL/索引', 6, []],
    ['MySQL/锁', 4, []],
    ['Redis', 6, []],
    ['SpringBoot', 12, []],
    ['test', 2, []],
    ['资料', 3, []],
    ['项目', 1, []],
    ['待整理的空分组', 0, []],
  ]

  var titles = {
    agent: ['Agent 的上下文工程', '工具调用的失败模式', 'ReAct 与 Plan-Execute', '子代理的边界'],
    Java: [
      'JMM 与 happens-before',
      '虚拟线程初探',
      'GC 分代与停顿',
      '类加载的双亲委派',
      'synchronized 的锁升级',
      'CompletableFuture 编排',
      'Java 21 新特性速览',
      'Stream 的惰性求值',
      '反射与动态代理',
    ],
    MySQL: ['慢查询定位三步', '执行计划里的 type'],
    'MySQL/WAL机制': [
      'WAL 与 redo log',
      'checkpoint 的时机',
      '组提交与刷盘',
      'binlog 三格式',
      '两阶段提交',
      '崩溃恢复流程',
      'undo 与 MVCC',
      'WAL 的写入放大',
    ],
    'MySQL/日志': ['redo 与 undo 的区别', 'relay log 与主从', '慢日志采样', '错误日志排查', '日志刷盘参数'],
    'MySQL/索引': [
      'B+ 树为什么是三到四层',
      '覆盖索引与回表',
      '联合索引的最左前缀',
      '索引下推',
      '唯一索引与普通索引',
      '自增主键的页分裂',
    ],
    'MySQL/锁': ['间隙锁与幻读', '意向锁的作用', '死锁现场还原', 'MDL 元数据锁'],
    Redis: ['跳表与 zset', '持久化 RDB 与 AOF', '缓存穿透三件套', '集群槽位迁移', '大 key 治理', '分布式锁的坑'],
    SpringBoot: [
      '自动装配的原理',
      'Bean 生命周期',
      '循环依赖三级缓存',
      'AOP 代理时机',
      '事务失效场景',
      '配置绑定的松散规则',
      'starter 自定义',
      '拦截器与过滤器',
      '全局异常处理',
      'Actuator 健康检查',
      '优雅停机',
      '启动加速实录',
    ],
    test: ['临时验证 A', '临时验证 B'],
    资料: ['写作素材索引', '参考文献清单', '术语对照表'],
    项目: ['ZenReader 迭代日志'],
  }

  var now = Date.UTC(2026, 1, 20, 10, 0, 0)

  /** 换前缀：改名 / 搬家后目录、子目录、卷、以及各自的名字都要跟着换。 */
  function rewritePrefix(prefixFrom, prefixTo) {
    var from = prefixFrom + '/'
    var fromFile = prefixFrom + '/'
    var toFile = prefixTo + '/'
    if (!prefixFrom) return
    folders.forEach(function (f) {
      if (f[0] === prefixFrom) f[0] = prefixTo
      else if (f[0].indexOf(from) === 0) f[0] = prefixTo + '/' + f[0].slice(from.length)
    })
    Object.keys(titles).forEach(function (key) {
      if (key === prefixFrom) {
        titles[prefixTo] = titles[key]
        delete titles[key]
      } else if (key.indexOf(from) === 0) {
        titles[prefixTo + '/' + key.slice(from.length)] = titles[key]
        delete titles[key]
      }
    })
    void fromFile
    void toFile
  }

  function moveFolder(from, to) {
    if (!from || !to || from === to) return
    rewritePrefix(from, to)
  }

  function listing() {
    var files = []
    folders.forEach(function (entry) {
      var folder = entry[0]
      var pool = titles[folder] || []
      for (var i = 0; i < entry[1]; i += 1) {
        var title = pool[i] || folder + ' 卷 ' + (i + 1)
        // 资料里混一篇 HTML，好让「卷式」筛选在侧栏有东西可筛
        var isHtml = folder === '资料' && i === 0
        var name = title + (isHtml ? '.html' : '.md')
        files.push({
          name: name,
          path: settings.vaultPath + '\\' + folder + '\\' + name,
          relativePath: folder + '/' + name,
          mtime: now - files.length * 3600000 * 7,
        })
      }
    })
    return { files: files, dirs: folders.map(function (f) { return f[0] }) }
  }

  /**
   * 展开态的 localStorage 键，按 useFolderExpansion.storageKey() 的同一条规则从
   * vaultPath 推出来，并挂到 window 上供探针按名预置（`--expanded=`）。
   *
   * 为什么要公开：这条键是**实现细节**（路径 slug 规则 + 前缀），探针里另抄一份就会
   * 在替身换 vaultPath 时悄悄对不上——`--expanded` 失效时页面照样出图，只是出的是
   * 默认态，很难发现（第九轮那个 D__ 双下划线的旧常量就是这么来的）。
   */
  function expansionKey() {
    var slug = String(settings.vaultPath || '').replace(/[^\w.-]+/g, '_').slice(-96)
    return 'zenreader.folder.expanded.' + slug
  }
  window.__ZEN_EXPANSION_KEY = expansionKey()

  function readSettings() {
    // localStorage 里的键整份覆盖仿真设置——否则新加的设置项（如侧栏宽度）
    // 会被这里的默认值悄悄盖掉，预览里调什么都看不到效果。
    // 主题仍单拎出来看，因为首帧防闪烁脚本读的就是它。
    var overrides = {}
    try {
      var ls = JSON.parse(localStorage.getItem('zenreader:settings') || '{}')
      if (ls && typeof ls === 'object') overrides = ls
    } catch (e) {
      /* 坏值不该让预览开不了张 */
    }
    return JSON.stringify(Object.assign({}, settings, overrides))
  }

  window.__TAURI_INTERNALS__ = {
    // @tauri-apps/api/window 与 webview 会读 metadata.currentWindow/currentWebview
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main', windowLabel: 'main' },
    },
    invoke: function (cmd, args) {
      switch (cmd) {
        case 'read_settings':
          return Promise.resolve(readSettings())
        case 'read_vault':
          return Promise.resolve(listing())
        case 'set_active_vault':
        case 'write_settings':
        case 'write_file':
        case 'plugin:app|version':
          return Promise.resolve(null)
        case 'notes_list':
          return Promise.resolve([])
        // 改名 / 搬家：真的改这份仿真书库，好让预览看到落盘后的样子。
        case 'rename_dir':
        case 'notes_rename_folder': {
          var a = args || {}
          if (cmd === 'rename_dir') moveFolder(a.from, a.to)
          return Promise.resolve(null)
        }
        default:
          return Promise.resolve(null)
      }
    },
    transformCallback: function (cb) {
      var id = Math.floor(Math.random() * 1e9)
      window['_' + id] = cb
      return id
    },
  }
})()
