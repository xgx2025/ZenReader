/*
 * ZenReader 沙箱帧 agent（原文页面同源）。
 *
 * 独立、自含的 IIFE：不 import 任何应用模块。宿主把这段源码以 ?raw 字符串塞进
 * srcdoc（紧随 <base> 之后、页面脚本之前），因此它最先运行、先清 IPC，再跟宿主
 * 用 postMessage 走 zenasset 协议。任何输入都视为不可信；宿主侧还会二次自证。
 *
 * 给单测：把 `agent(hostMessageFn)` 暴露出来——注入假 parent/window 即测内部函数。
 */
;(function zenAgent(hostSend) {
  'use strict'

  // ---------- 0. 配置与防御 ----------
  var CFG = (window.__ZENREADER_CFG || {})

  /**
   * 万一帧内真的注入了同 webview 的 IPC：能删就整个删掉；删不动（WebView2 里
   * __TAURI_INTERNALS__ 是不可配置属性，严格模式下 delete 会直接抛）就退回"遮蔽为
   * null"；连写都写不进（只读）就静默放过——真正的边界是 sandbox 不透明源，这里
   * 只是纵深防御，绝不能因为这一步抛错而让 agent 本身起不来。
   */
  function purgeIpc() {
    try {
      delete window.__TAURI_INTERNALS__
      return
    } catch (e) {
      /* 不可配置 → 改走遮蔽 */
    }
    try {
      window.__TAURI_INTERNALS__ = null
    } catch (e2) {
      /* 只读——交沙箱兜底 */
    }
  }
  purgeIpc()

  /**
   * 沙箱（不透明源）里读 localStorage/sessionStorage 会抛 SecurityError——原页面脚本
   * 常因此红色报错并中断后续。别给它真存储（也不该有）：在帧内遮蔽一个**一次性内存
   * 替身**，页面读写在内存里静默完成、每次重开即空——既不打断它后续脚本，也永远触
   * 不到宿主 / 落盘。能访问真存储的环境（无沙箱 dev）则原样不动。
   */
  function shimStorage() {
    function memoryStore() {
      var map = Object.create(null)
      return {
        getItem: function (k) {
          k = String(k)
          return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null
        },
        setItem: function (k, v) {
          map[String(k)] = String(v)
        },
        removeItem: function (k) {
          delete map[String(k)]
        },
        clear: function () {
          var ks = Object.keys(map)
          for (var i = 0; i < ks.length; i++) delete map[ks[i]]
        },
        key: function (i) {
          var ks = Object.keys(map)
          return i >= 0 && i < ks.length ? ks[i] : null
        },
        get length() {
          return Object.keys(map).length
        },
      }
    }
    function install(name) {
      try {
        void window[name] // 能直接读 → 浏览器给了真存储，不动它
        return
      } catch (e) {
        /* 沙箱抛错 → 安装内存替身 */
      }
      try {
        Object.defineProperty(window, name, {
          value: memoryStore(),
          configurable: true,
          writable: true,
        })
      } catch (e2) {
        /* 装不上（如 unforgeable）就随它抛原错，agent 不受影响 */
      }
    }
    install('localStorage')
    install('sessionStorage')
  }
  shimStorage()

  var NONCE = CFG.nonce || ''
  var EXCLUDED_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TITLE: 1, HEAD: 1 }
  var DOC_EXT = /\.(md|markdown|html|htm)$/i
  var TOGGLE_KEYS = { t: 1, n: 1, z: 1, '?': 1, Escape: 1 }
  var NAV_KEYS = { ' ': 1, ArrowDown: 1, ArrowUp: 1, ArrowLeft: 1, ArrowRight: 1, Home: 1, End: 1, PageDown: 1, PageUp: 1, j: 1, k: 1 }

  var MAX_QUOTE = 2000

  function post(type, payload) {
    try {
      hostSend({ v: 1, nonce: NONCE, type: type, payload: payload })
    } catch (e) {
      /* 宿主已离开——静默 */
    }
  }

  // ---------- 1. 纯文本索引（与宿主 extractHtmlText 同口径：剔 script/style 等） ----------
  function excluded(node) {
    return !!EXCLUDED_TAGS[node.nodeName] || node.nodeName === 'INPUT' || node.nodeName === 'TEXTAREA'
  }

  /** 收集 body 内可见文本节点（跳过整棵被排除子树）。 */
  function visibleTextNodes() {
    var out = []
    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (n) {
          var p = n.parentNode
          while (p) {
            if (excluded(p)) return NodeFilter.FILTER_REJECT
            p = p.parentNode
          }
          return NodeFilter.FILTER_ACCEPT
        },
      },
    )
    var cur
    while ((cur = walker.nextNode())) out.push(cur)
    return out
  }

  /** 全文（原文 textContent，不做空白归一——包 mark 需要真实 DOM 坐标）。 */
  function fullText() {
    var nodes = visibleTextNodes()
    var s = ''
    for (var i = 0; i < nodes.length; i++) s += nodes[i].data
    return s
  }

  /** 文本节点序号 -> 其在全文中的起点偏移。 */
  function textOffsets(nodes) {
    var acc = []
    var pos = 0
    for (var i = 0; i < nodes.length; i++) {
      acc.push(pos)
      pos += nodes[i].data.length
    }
    return acc
  }

  // ---------- 2. 划词捕获（移植自应用 textAnchor.ts 的规则） ----------
  var CONTEXT_LENGTH = 100

  function nodeIndexOf(node, offsets, nodes) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === node) return offsets[i]
    }
    return null
  }

  function countBefore(text, needle, idx) {
    var c = 0
    var at = text.indexOf(needle)
    while (at !== -1 && at < idx) {
      c++
      at = text.indexOf(needle, at + needle.length)
    }
    return c
  }

  function captureSelection() {
    var sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    var range = sel.getRangeAt(0)
    // v1：单段选区内锚定稳定；跨段（含 \n）放弃，与 md 同一体验。
    if (range.toString().indexOf('\n') !== -1) return { crossBlock: true }
    if (!document.body.contains(range.startContainer) || !document.body.contains(range.endContainer)) return null

    var nodes = visibleTextNodes()
    var offsets = textOffsets(nodes)
    var text = fullText()
    var start = nodeIndexOf(range.startContainer, offsets, nodes)
    var end = nodeIndexOf(range.endContainer, offsets, nodes)
    if (start === null || end === null || start === end) return null
    var lo = Math.min(start, end)
    var hi = Math.max(start, end)
    var quote = text.slice(lo, hi)
    if (!quote || !quote.trim() || quote.length > MAX_QUOTE) return null

    var prefix = text.slice(Math.max(0, lo - CONTEXT_LENGTH), lo)
    var suffix = text.slice(hi, hi + CONTEXT_LENGTH)
    var occurrence = countBefore(text, quote, lo)

    var rect = range.getBoundingClientRect()
    if (!rect || rect.width < 1 && rect.height < 1) return null
    // 以帧视口宽高的比例传坐标：CSS zoom 后仍与可见位置一致，宿主再换算成父坐标。
    return {
      anchor: { quote: quote, prefix: prefix, suffix: suffix, occurrence: occurrence },
      rect: {
        left: rect.left / window.innerWidth,
        top: rect.top / window.innerHeight,
        width: rect.width / window.innerWidth,
        height: rect.height / window.innerHeight,
      },
    }
  }

  function onMouseUp() {
    var cap = captureSelection()
    if (cap && cap.crossBlock) {
      post('evt.selection', { state: 'crossBlock' })
      return
    }
    post('evt.selection', cap ? { state: 'select', anchor: cap.anchor, rect: cap.rect } : { state: 'dismiss' })
  }

  // 点他处（不划词）即收起浮动条——宿主侧等价 md 的 dismiss。
  function onDownClear(e) {
    try {
      var sel = window.getSelection()
      if (!sel || sel.isCollapsed) return
      var t = e.target
      if (t && t.closest && t.closest('mark.zen-hl')) return // 点到既有高亮保留
      if (t && t.nodeType === 1 && (t.tagName === 'A' || t.tagName === 'BUTTON')) return
    } catch (e2) {
      /* noop */
    }
  }

  // ---------- 3. 目录 / 定位 ----------
  function headings() {
    var list = []
    var all = document.querySelectorAll('h1,h2,h3,h4,h5,h6')
    for (var i = 0; i < all.length; i++) {
      var t = all[i].textContent.replace(/\s+/g, ' ').trim()
      if (!t) continue
      list.push({ el: all[i], level: Number(all[i].tagName[1]), text: t })
    }
    return list
  }

  function outlinePayload() {
    return headings().map(function (h) {
      return { level: h.level, text: h.text }
    })
  }

  // ---------- 4. 高亮打/拆（整批替换，幂等） ----------
  function findNth(text, needle, n) {
    var idx = text.indexOf(needle)
    var c = 0
    while (idx !== -1) {
      if (c === n) return idx
      c++
      idx = text.indexOf(needle, idx + 1)
    }
    return -1
  }

  function overlap(a, b) {
    if (!b) return 0
    var n = Math.min(a.length, b.length)
    var s = 0
    for (var i = 0; i < n; i++) if (a[i] === b[i]) s++
    return s
  }

  function bestOccurrence(text, anchor) {
    var occ = []
    var idx = text.indexOf(anchor.quote)
    while (idx !== -1) {
      occ.push(idx)
      idx = text.indexOf(anchor.quote, idx + 1)
    }
    if (!occ.length) return -1
    if (occ.length === 1) return occ[0]
    var best = occ[0]
    var bestScore = -1
    for (var i = 0; i < occ.length; i++) {
      var before = text.slice(Math.max(0, occ[i] - anchor.prefix.length), occ[i])
      var after = text.slice(occ[i] + anchor.quote.length, occ[i] + anchor.quote.length + anchor.suffix.length)
      var sc = overlap(before, anchor.prefix) + overlap(after, anchor.suffix)
      if (sc > bestScore) {
        bestScore = sc
        best = occ[i]
      }
    }
    return best
  }

  function wrapAt(start, end, noteId) {
    var nodes = visibleTextNodes()
    var offsets = textOffsets(nodes)
    var pos = 0
    var startNode = null
    var startOff = 0
    var endNode = null
    var endOff = 0
    for (var i = 0; i < nodes.length; i++) {
      var len = nodes[i].data.length
      if (!startNode && start < pos + len) {
        startNode = nodes[i]
        startOff = start - pos
      }
      if (!endNode && end <= pos + len) {
        endNode = nodes[i]
        endOff = end - pos
      }
      if (startNode && endNode) break
      pos += len
    }
    if (!startNode || !endNode) return false
    var r = document.createRange()
    r.setStart(startNode, startOff)
    r.setEnd(endNode, endOff)
    if (r.toString() !== '') {
      var mark = document.createElement('mark')
      mark.className = 'zen-hl'
      mark.setAttribute('data-note-id', noteId)
      mark.appendChild(r.extractContents())
      r.insertNode(mark)
      return true
    }
    return false
  }

  function applyAnchors(items) {
    var old = document.querySelectorAll('mark.zen-hl')
    for (var i = 0; i < old.length; i++) {
      var p = old[i].parentNode
      if (!p) continue
      while (old[i].firstChild) p.insertBefore(old[i].firstChild, old[i])
      p.removeChild(old[i])
      p.normalize()
    }
    if (!items || !items.length) return
    var text = fullText()
    for (var j = 0; j < items.length; j++) {
      var a = items[j].anchor
      if (!a || !a.quote) continue
      var start = findNth(text, a.quote, a.occurrence)
      if (start === -1) start = bestOccurrence(text, a)
      if (start === -1) continue // 漂移太多：宁缺毋错
      wrapAt(start, start + a.quote.length, items[j].noteId)
    }
  }

  // ---------- 5. 滚动 ----------
  function scrollable() {
    return document.scrollingElement || document.documentElement
  }

  function scrollInfo() {
    var sc = scrollable()
    var max = sc.scrollHeight - sc.clientHeight
    var activeIndex = -1
    var off = Math.min(140, sc.clientHeight * 0.2)
    var hd = headings()
    for (var i = 0; i < hd.length; i++) {
      var top = hd[i].el.getBoundingClientRect().top
      if (top <= off) activeIndex = i
      else break
    }
    return { ratio: max > 0 ? Math.min(1, sc.scrollTop / max) : 1, activeIndex: activeIndex, y: sc.scrollTop, delta: 0 }
  }

  var lastReport = 0
  var rafPending = false
  var lastInfo = null

  function reportScroll() {
    rafPending = false
    var now = Date.now()
    if (now - lastReport < 90) return // 节流：最快 ~11/s
    lastReport = now
    var info = scrollInfo()
    if (lastInfo) info.delta = info.y - lastInfo.y
    lastInfo = info
    post('evt.scroll', info)
  }

  function onScroll() {
    if (rafPending) return
    rafPending = true
    requestAnimationFrame(reportScroll)
  }

  function scrollToTop(y) {
    var sc = scrollable()
    sc.scrollTo({ top: y, behavior: 'auto' })
  }

  // ---------- 6. 键 / 链接拦截 ----------
  function isEditable(t) {
    if (!t || t.nodeType !== 1) return false
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true
    var ce = t.getAttribute && t.getAttribute('contenteditable')
    return ce === 'true' || ce === '' || t.isContentEditable
  }

  function isBodyLevel(t) {
    return t === document.body || t === document.documentElement || t === document
  }

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    var t = e.target
    if (isEditable(t)) return
    var key = e.key
    var payload = { key: key, shiftKey: e.shiftKey }
    if (NAV_KEYS[key]) {
      // 读屏自有滚动键：阻止浏览器默认，交给宿主统一处理（避免双向滚动翻倍）。
      if (isBodyLevel(t)) e.preventDefault()
      post('evt.key', payload)
    } else if (TOGGLE_KEYS[key]) {
      post('evt.key', payload) // 面板开合由宿主裁决，不 preventDefault
    }
  }

  /**
   * 页内锚点（`#id`）自己接管。
   *
   * 宿主注入的 `<base href="zenasset://…/">` 是所有相对 URL 的解析基准——`#hero`
   * 因此被解析成 `zenasset://…/#hero`：与本文档（about:srcdoc）不同文档，浏览器
   * 走的是**整帧导航**而非同文档跳转，表现就是"点目录没反应"。base 又删不得
   * （相对图片/字体/CSS 全靠它落到资产协议上），所以只能在这儿把语义补回来：
   * 本页找 target 再滚，效果与原生同文档跳转一致。
   *
   * 已知不覆盖：靠 `:target` 选择器或 hashchange 事件驱动的目录（真实 fragment
   * 导航始终没发生）——不透明源里也改不了 location/history。
   */
  function jumpToFragment(href) {
    var id = href.slice(1)
    try {
      id = decodeURIComponent(id)
    } catch (e) {
      /* 非法转义：按原样找 */
    }
    var sc = scrollable()
    if (!id) {
      // 光秃秃的 `#`：按链接惯例回卷首，比"什么都不发生"更贴近语义。
      sc.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    var el = document.getElementById(id)
    if (!el) {
      var named = document.getElementsByName(id) // `<a name="…">` 老式锚点
      if (named && named.length) el = named[0]
    }
    if (!el) return // target 不存在 = 原地不动（与原生一致）
    // 落点让开沉浸式玻璃条：agent 注入的 scroll-padding-top（见 ensureTopInset）。
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function onDocClick(e) {
    if (e.defaultPrevented || e.button !== 0) return
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null
    if (!a) return
    var href = a.getAttribute('href') || ''
    if (!href) return
    if (href.charAt(0) === '#') {
      e.preventDefault()
      jumpToFragment(href)
      return
    }
    var url = null
    try {
      url = new URL(href, document.baseURI)
    } catch (err) {
      return
    }
    var proto = (url.protocol || '').replace(':', '').toLowerCase()
    // 外链/邮件：交给宿主用系统浏览器打开，别让帧导航离开原文档。
    if (proto === 'http' || proto === 'https' || proto === 'mailto') {
      e.preventDefault()
      post('evt.openExternal', { url: url.href })
      return
    }
    // 书库互链：内部路由打开（宿主 resolveDocLink 自证），其余库内资产链接不导航
    //（与 md 同款：点了也无事），file: 永不开。
    if (proto === 'zenasset') {
      e.preventDefault()
      if (DOC_EXT.test(url.pathname)) {
        post('evt.openDoc', { href: href.split('#')[0].split('?')[0] })
      }
      return
    }
    if (proto === 'file') e.preventDefault()
  }

  // ---------- 7. 主题 / 缩放 ----------
  function ensureHlStyle() {
    if (document.getElementById('zr-hl-style')) return
    var st = document.createElement('style')
    st.id = 'zr-hl-style'
    st.textContent =
      'mark.zen-hl{background:var(--zr-hl-bg,rgba(196,122,72,.26));color:inherit;' +
      'border-radius:2px;padding:.05em .1em;cursor:pointer}' +
      'mark.zen-hl:hover,mark.zen-hl.active{background:var(--zr-hl-bg-strong,rgba(196,122,72,.42))}' +
      'mark.zen-hl-pulse{animation:zrHlPulse 1.2s ease}@keyframes zrHlPulse{0%{box-shadow:0 0 0 0 var(--zr-hl-ring,rgba(196,122,72,.6))}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}'
    ;(document.head || document.documentElement).appendChild(st)
  }

  /**
   * html 沉浸式阅读的「起始留白」：给 <body> 顶部加与浮条等高（px）的 padding，
   * 让文章起点对齐在玻璃条下沿，滚动后正文才滑入条下。两条保险：
   * ① CSS 变量 + `html body` 规则（特异性高于作者常写的 `body`，首帧即生效）；
   * ② body 行内样式（压过作者常规规则；body 就绪后再调一次即可命中）。
   * 高亮配色等注入样式仅叠加、不改排版，这条是刻意为之的排版性注入。
   *
   * 同时给出 `scroll-padding-top`：锚点跳转（帧内目录、页内 `#id`）落在留白下沿，
   * 标题不会一头扎进玻璃条底下。页面自己设了 scroll-padding 时以页面的为准——
   * 本 <style> 早于页面样式落地，同特异性下后者胜。
   */
  function ensureTopInset(px) {
    if (!document.getElementById('zr-top-inset')) {
      var st = document.createElement('style')
      st.id = 'zr-top-inset'
      st.textContent =
        'html{scroll-padding-top:var(--zr-top-inset,0px)}' +
        'html body{padding-top:var(--zr-top-inset,0px)}'
      ;(document.head || document.documentElement).appendChild(st)
    }
    var v = px > 0 ? px + 'px' : '0px'
    document.documentElement.style.setProperty('--zr-top-inset', v)
    if (document.body) document.body.style.setProperty('padding-top', v)
  }

  var THEME_HL = {
    light: { bg: 'rgba(196,122,72,.26)', strong: 'rgba(196,122,72,.44)' },
    sepia: { bg: 'rgba(184,116,58,.28)', strong: 'rgba(184,116,58,.46)' },
    dark: { bg: 'rgba(226,160,110,.30)', strong: 'rgba(226,160,110,.50)' },
  }

  function setTheme(theme) {
    ensureHlStyle()
    var c = THEME_HL[theme] || THEME_HL.light
    var root = document.documentElement
    root.style.setProperty('--zr-hl-bg', c.bg)
    root.style.setProperty('--zr-hl-bg-strong', c.strong)
    root.style.setProperty('--zr-hl-ring', c.bg)
  }

  function setZoom(z) {
    var sc = scrollable()
    var ratio = sc.scrollHeight > sc.clientHeight ? sc.scrollTop / (sc.scrollHeight - sc.clientHeight) : 0
    document.documentElement.style.zoom = String(z)
    // 缩放后按比例保持阅读位置。
    var sc2 = scrollable()
    if (sc2.scrollHeight > sc2.clientHeight) {
      sc2.scrollTop = ratio * (sc2.scrollHeight - sc2.clientHeight)
    }
    onScroll()
  }

  function scrollToNote(noteId) {
    var mark = document.querySelector('mark.zen-hl[data-note-id="' + CSS.escape(noteId) + '"]')
    if (!mark) return false
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
    mark.classList.remove('zen-hl-pulse')
    void mark.offsetWidth
    mark.classList.add('zen-hl-pulse')
    return true
  }

  function scrollToHeading(index) {
    var hd = headings()
    if (!hd[index]) return
    hd[index].el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // 让标题别顶着视口上缘。
    var sc = scrollable()
    var top = hd[index].el.getBoundingClientRect().top + sc.scrollTop - 24
    sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }

  function scrollByFraction(fraction) {
    var sc = scrollable()
    sc.scrollBy({ top: window.innerHeight * fraction, behavior: 'smooth' })
  }

  function scrollEdge(edge) {
    var sc = scrollable()
    sc.scrollTo({ top: edge === 'top' ? 0 : sc.scrollHeight, behavior: 'smooth' })
  }

  function scrollToRatio(ratio) {
    var sc = scrollable()
    if (sc.scrollHeight > sc.clientHeight) {
      sc.scrollTop = Math.min(1, Math.max(0, ratio)) * (sc.scrollHeight - sc.clientHeight)
    }
  }

  // ---------- 8. 消息路由（宿主 → 帧） ----------
  function route(e) {
    var d = e.data
    if (!d || d.v !== 1 || d.nonce !== NONCE) return
    if (e.source !== window.parent) return
    switch (d.type) {
      case 'cmd.applyAnchors':
        applyAnchors(d.payload && d.payload.items)
        break
      case 'cmd.scrollToRatio':
        scrollToRatio(d.payload && d.payload.ratio)
        break
      case 'cmd.scrollToHeading':
        scrollToHeading(d.payload && d.payload.index)
        break
      case 'cmd.scrollToNote':
        scrollToNote(d.payload && d.payload.noteId)
        break
      case 'cmd.scrollByFraction':
        scrollByFraction(d.payload && d.payload.fraction)
        break
      case 'cmd.scrollEdge':
        scrollEdge(d.payload && d.payload.edge)
        break
      case 'cmd.setZoom':
        setZoom(d.payload && d.payload.zoom)
        break
      case 'cmd.setTheme':
        setTheme(d.payload && d.payload.theme)
        break
      case 'cmd.refreshOutline':
        post('evt.outline', outlinePayload())
        break
      case 'cmd.reportNow':
        post('evt.scroll', scrollInfo())
        break
      default:
        break
    }
  }

  // ---------- 9. 接线 ----------
  function start() {
    if (window.__ZEN_AGENT_STARTED__) return
    window.__ZEN_AGENT_STARTED__ = true
    ensureHlStyle()
    setTheme(CFG.theme || 'light')
    ensureTopInset(CFG.topInset || 0)

    window.addEventListener('message', route, false)
    document.addEventListener('mouseup', onMouseUp, false)
    document.addEventListener('mousedown', onDownClear, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('click', onDocClick, true)

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        ensureHlStyle()
        // body 已就绪：行内 padding 这一重保险现在才够得着。
        ensureTopInset(CFG.topInset || 0)
        post('evt.ready', {})
        post('evt.outline', outlinePayload())
        onScroll()
      }, false)
    } else {
      post('evt.ready', {})
      post('evt.outline', outlinePayload())
      onScroll()
    }
    // load 后内容/尺寸落定：补一发 outline 与滚动（宿主借此续读）。
    if (document.readyState === 'loading') {
      window.addEventListener('load', function () {
        post('evt.outline', outlinePayload())
        post('evt.scroll', scrollInfo())
      }, false)
    } else {
      setTimeout(function () {
        post('evt.outline', outlinePayload())
        post('evt.scroll', scrollInfo())
      }, 0)
    }
  }

  if (typeof hostSend === 'function') {
    start()
  } else {
    // 测试注入口：agent(messageSink)——由测试手动调 start 并驱动消息。
    window.__ZEN_AGENT_API__ = {
      start: start,
      route: route,
      applyAnchors: applyAnchors,
      jumpToFragment: jumpToFragment,
      scrollInfo: scrollInfo,
      outlinePayload: outlinePayload,
      captureSelection: captureSelection,
      setTheme: setTheme,
      setZoom: setZoom,
      scrollToNote: scrollToNote,
    }
  }
})(window.parent && typeof window.parent.postMessage === 'function' ? function (m) {
  // 真正宿主桥：把信封发回父窗口（opaque origin，targetOrigin 用 '*'）。
  window.parent.postMessage(m, '*')
} : null)
