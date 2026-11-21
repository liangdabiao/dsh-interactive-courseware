// 课件放映厅工作台 · 页面逻辑（无框架，hash 路由 + fetch /api/*）
// 布局对齐「课程工坊」：左侧 rail，右侧按路由渲染；
// 「发起制作」通过 postMessage 让宿主开新对话并填好创作指令。
const app = document.getElementById('app')
const navArchives = document.getElementById('nav-archives')
const navHistory = document.getElementById('nav-history')
const railFoot = document.getElementById('rail-foot')
const viewer = document.getElementById('viewer')
const viewerTitle = document.getElementById('viewer-title')
const viewerBody = document.getElementById('viewer-body')
const viewerCopy = document.getElementById('viewer-copy')
const toastEl = document.getElementById('toast')

// 页面挂在 /dsh-interactive-courseware/ 下，接口同前缀（不能用 '/api/...' 根绝对路径，会打到宿主）
const BASE = location.pathname.replace(/\/+$/, '') || '/dsh-interactive-courseware'

const state = { catalog: null, q: '', kind: 'all', previewId: null, previewFile: 'index.html' }

const KIND = { create: '新建', update: '更新', delete: '删除', restore: '恢复' }
const KIND_TONE = { create: 'ok', update: 'solid', delete: 'bad', restore: 'gold' }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const date = (iso) => (iso ? String(iso).slice(0, 10) : '')
const shortTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const kindLabel = (k) => KIND[k] || k || ''
const kb = (n) => (n ? `${(n / 1024).toFixed(0)} KB` : '')

async function api(path, opts) {
  const res = await fetch(BASE + path, opts)
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.ok === false) throw new Error(body.error || `请求失败（${res.status}）`)
  return body
}

async function post(path, payload) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {})
  })
}

function copy(text) {
  const value = String(text || '')
  if (!value) return
  try { navigator.clipboard?.writeText(value) } catch { /* ignore */ }
  toast('已复制到剪贴板')
}

// ---------------------------------------------------------------- 宿主通信 / 主题

addEventListener('message', (e) => {
  if (e.origin !== location.origin) return
  const m = e.data
  if (m && m.type === 'dsh-interactive-courseware:scheme' && m.scheme) document.documentElement.dataset.scheme = m.scheme
  if (m && m.type === 'dsh-interactive-courseware:start-failed') toast('开新对话失败：' + (m.message || '') + '；可点「复制指令」手动粘贴到新对话')
})

function start(prompt) {
  try {
    parent.postMessage({ type: 'dsh-interactive-courseware:start', prompt }, location.origin)
    toast('已把创作指令交给新对话，确认后发送；没看到新对话就点「复制指令」手动粘贴')
  } catch {
    toast('当前环境开不了新对话，请点「复制指令」粘贴到新对话')
  }
}

let toastTimer
function toast(text) {
  toastEl.textContent = text
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3400)
}

// ---------------------------------------------------------------- viewer（源码查看）

let viewerText = ''
function openViewer(title, text, { monospace = true } = {}) {
  viewerTitle.textContent = title
  viewerText = text || ''
  viewerBody.innerHTML = `<pre class="pre" style="max-height:none">${esc(viewerText)}</pre>`
  viewerCopy.hidden = false
  viewer.hidden = false
}
function closeViewer() { viewer.hidden = true }
viewerCopy.addEventListener('click', () => copy(viewerText))
viewer.addEventListener('click', (e) => { if (e.target === viewer) closeViewer() })
document.getElementById('viewer-close').addEventListener('click', closeViewer)
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !viewer.hidden) closeViewer() })

// ---------------------------------------------------------------- 数据

async function loadCatalog(force) {
  if (state.catalog && !force) return state.catalog
  state.catalog = await api('/api/catalog')
  return state.catalog
}

function badge(ok, okText, badText) {
  return `<span class="badge ${ok ? 'ok' : 'bad'}">${ok ? okText : badText}</span>`
}

// ---------------------------------------------------------------- 路由

async function render() {
  const hash = location.hash.replace(/^#\/?/, '') || 'home'
  const [view, query = ''] = hash.split('?')
  // 档案卡片上的「预览」带 ?id=：先把要放的那份记下来，否则永远放列表第一份
  const wantId = new URLSearchParams(query).get('id')
  if (wantId) { state.previewId = wantId; state.previewFile = 'index.html' }
  document.querySelectorAll('.nav a[data-view]').forEach((a) =>
    a.setAttribute('aria-current', a.dataset.view === view ? 'true' : 'false'))
  try {
    const catalog = await loadCatalog(true)
    const views = { home: viewHome, new: viewNew, archives: viewArchives, preview: viewPreview, history: viewHistory, guide: viewGuide }
    app.innerHTML = (views[view] || viewHome)(catalog)
    const binders = { home: bindArchives, new: bindNew, archives: bindArchives, preview: bindPreview, history: bindHistory }
    if (binders[view]) binders[view](catalog, view)
    bindServeButtons()
  } catch (err) {
    app.innerHTML = `<div class="empty-box"><b>看板加载失败</b>${esc(err.message || err)}
      <div style="margin-top:10px"><button class="btn small" id="retry">重试</button>
      <span class="preview-note">点了没反应就先确认 DSH 还在运行。</span></div></div>`
    document.getElementById('retry')?.addEventListener('click', () => render())
  }
  navArchives.textContent = state.catalog?.archives?.length || ''
  navHistory.textContent = state.catalog?.history?.length || ''
  const s = state.catalog?.stats
  railFoot.innerHTML = s
    ? `<span class="txt">课件档案 ${s.archives} · 页 ${s.pages} · 已打包 ${s.packed} · 历史 ${s.events}</span><span class="txt">v${esc(state.catalog.version || '?')}</span>`
    : ''
}

// 预览服务的启动按钮：概览页和预览页共用一处实现
function bindServeButtons() {
  app.querySelectorAll('[data-serve]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = '启动中…'
      try {
        const out = await post('/api/serve')
        toast(out.alreadyRunning ? '服务已在运行' : '预览服务已启动')
      } catch (err) {
        toast('启动失败：' + (err.message || err))
      }
      render()
    }))
}

// ---------------------------------------------------------------- 概览

function viewHome(c) {
  const s = c.stats || {}
  const server = c.server || {}
  const recent = (c.archives || []).slice(0, 6)
  return `
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">INTERACTIVE COURSEWARE</div>
      <h1>课件放映厅</h1>
      <p>提需求 → agent 按 interactive-courseware 技能三阶段创作（设计蓝图 → 生成页面 → 装进播放器）→ 机械红线盘点 → 打包单文件 → 存证入档 → 这里翻页预览<b>真实播放器</b>放映的课件。</p>
      <div class="toolbar" style="margin-top:10px">
        <a class="btn jade" href="#/new">发起制作 →</a>
        <a class="btn ghost" href="#/preview">看课件预览</a>
      </div>
    </div>

    <div class="stats">
      <div class="stat accent"><b>${s.archives ?? 0}</b><small>课件档案</small></div>
      <div class="stat"><b>${s.pages ?? 0}</b><small>页面合计</small></div>
      <div class="stat jade"><b>${s.packed ?? 0}</b><small>已打包单文件</small></div>
      <div class="stat gold"><b>${s.events ?? 0}</b><small>历史事件</small></div>
    </div>

    <div class="sec-head"><h2>环境</h2><span class="sub">预览服务与技能快照</span></div>
    <div class="panel">
      <dl class="kv">
        <dt>预览服务</dt><dd>${server.up
          ? badge(true, `运行中 :${server.port}`)
          : '<span class="badge gold">未启动</span> <button class="btn small" data-serve>启动预览服务</button>'} <span class="preview-note">预览 = 档案库里的真实课件（完整播放器，可翻页、目录、全屏、静音）</span></dd>
        <dt>技能快照</dt><dd>${(c.skills || []).map((k) => `<code>${esc(k.name)}</code>（${k.bodyChars} 字）`).join('　') || '—'}</dd>
        <dt>成品长什么样</dt><dd>插件已内置两套真实范例（阿基米德与浮力 / 勾股定理双证记），在「课件档案」里带示例标，随时预览。</dd>
      </dl>
    </div>

    <div class="sec-head"><h2>最近课件</h2><a class="more" href="#/archives">全部档案 →</a></div>
    ${recent.length ? `<div class="grid">${recent.map(archiveCard).join('')}</div>`
      : `<div class="empty-box"><b>还没有课件档案</b>去「发起制作」提一个课件需求，agent 做完会存证到这里。</div>`}
  </div>`
}

// ---------------------------------------------------------------- 档案卡片

function archiveCard(a) {
  const dotColor = a.colors?.accent || 'var(--accent)'
  return `
  <div class="card plain" data-id="${esc(a.id)}">
    <div class="card-top">
      <span class="dot" style="background:${esc(dotColor)};outline:1px solid var(--line)"></span>
      <span class="card-title" title="${esc(a.title)}">${esc(a.title)}</span>
      ${a.packed ? '<span class="badge ok">已打包</span>' : '<span class="badge gold">未打包</span>'}
      ${a.sample ? '<span class="badge grey">示例</span>' : ''}
    </div>
    <div class="card-sub muted">${esc(a.subject)} · ${esc(a.grade)} ｜ ${a.pageCount} 页</div>
    <div class="card-sub">${a.goal ? esc(a.goal) : '<span style="color:var(--ink-3)">（无教学目标备注）</span>'}</div>
    <div class="card-foot">
      <span>${kb(a.packBytes) || '—'}</span><span>${a.checkWarns ? `${a.checkWarns} 条警告` : '盘点干净'}</span>
      ${a.revisions ? `<span>${a.revisions} 版</span>` : ''}
      <span class="grow"></span>
      <a class="btn small ghost" href="#/preview?id=${encodeURIComponent(a.id)}">预览</a>
      <button class="btn small danger" data-del="${esc(a.id)}">删除</button>
    </div>
    <div class="card-foot" style="margin-top:4px"><span>${date(a.createdAt)}${a.updatedAt !== a.createdAt ? ` · 更新 ${date(a.updatedAt)}` : ''}</span></div>
  </div>`
}

// ---------------------------------------------------------------- 发起制作

function viewNew(c) {
  const serverUp = c.server?.up
  return `
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">NEW COURSEWARE</div>
      <h1>发起制作</h1>
      <p>把讲义/课文内容给 agent，或一句话说清你想要的课件。agent 会先出《课件设计蓝图》给你确认，再一口气生成全部页面。</p>
    </div>

    <div class="panel">
      <textarea id="f-topic" rows="3" placeholder="例：这是《阿基米德与浮力》一节课的讲义……（直接粘贴内容）或：做一节月相成因的互动课，学生能拖动月亮绕地球转并对照日历"></textarea>
      <div class="toolbar" style="margin-top:10px;margin-bottom:0">
        <span class="preview-note">试试：</span>
        <button class="pill" data-ex="做一节《月相成因》互动课：学生拖动月亮绕地球公转，对照日历看 phases 变化，配月相配对小游戏">月相成因</button>
        <button class="pill" data-ex="做一节《分数的意义》互动课：披萨分块游戏练分数比较，先猜再揭晓">分数的意义</button>
        <button class="pill" data-ex="把这篇《桂林山水》课文做成互动课件：词语分类小游戏 + 跟读页，语文课投影用">桂林山水</button>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn jade" id="f-start">发起制作</button>
        <button class="btn ghost" id="f-copy">复制指令</button>
        <span class="preview-note">agent 做完会自动存证；预览服务没起时在「课件预览」页点一下「启动预览服务」。${serverUp ? '' : '（当前预览服务未启动）'}</span>
      </div>
      <details style="margin-top:14px">
        <summary class="preview-note" style="cursor:pointer">查看将发给 agent 的完整指令</summary>
        <textarea id="f-prompt" rows="9" readonly style="margin-top:8px;font-family:ui-monospace,Consolas,monospace;font-size:11.5px"></textarea>
      </details>
    </div>
  </div>`
}

function buildPrompt(topic) {
  return [
    '请用 interactive-courseware 技能把下面内容做成一套翻页互动课件：',
    '',
    String(topic).trim(),
    '',
    '要求：先输出《课件设计蓝图》（课情判断 / 创意概念 / 玩法判断 / 3D 判断 / 配色与气质 / 页面序列表）停下等我确认；确认后再连续生成全部页面。',
    '页面只放内容，翻页由播放器提供；遵守八条硬性规则（不用 Emoji、不用外链图片、颜色只有底色+一种强调色+黑白灰、一屏一页主体要大…）。',
    '',
    '完成闭环：courseware scaffold 落三段固定代码 → 写全部 page-XX.html → courseware check（警告逐条修）→ courseware pack 打包单文件 → courseware save 存证（填学科/学段/教学目标）→ courseware serve，并告诉我去侧栏「课件放映厅」翻页预览。',
  ].join('\n')
}

function bindNew() {
  const topic = document.getElementById('f-topic')
  const promptEl = document.getElementById('f-prompt')
  const sync = () => { promptEl.value = buildPrompt(topic.value.trim()) }
  app.querySelectorAll('.pill[data-ex]').forEach((pill) =>
    pill.addEventListener('click', () => { topic.value = pill.dataset.ex; sync() }))
  topic?.addEventListener('input', sync)
  document.getElementById('f-copy')?.addEventListener('click', () => {
    if (!topic.value.trim()) { toast('先写一句话需求'); return }
    sync(); copy(promptEl.value)
  })
  document.getElementById('f-start')?.addEventListener('click', () => {
    const prompt = topic.value.trim()
    if (!prompt) { toast('先写一句话需求'); return }
    sync()
    start(prompt)
  })
}

// ---------------------------------------------------------------- 课件档案

function viewArchives(c) {
  const list = (c.archives || []).filter((a) =>
    !state.q || `${a.title} ${a.deckTitle} ${a.subject} ${a.goal}`.toLowerCase().includes(state.q.toLowerCase()))
  return `
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">ARCHIVE</div>
      <h1>课件档案</h1>
      <p>每份档案是课件交付物（index.html + 全部页面 + 单文件版）的存证副本；删除可从历史恢复。带「示例」标的是插件内置的真实成品范例。</p>
    </div>
    <div class="toolbar">
      <input class="search" id="a-search" placeholder="搜标题 / 学科 / 教学目标…" value="${esc(state.q)}">
      <a class="btn small" href="#/new">发起制作</a>
    </div>
    ${list.length ? `<div class="grid">${list.map(archiveCard).join('')}</div>`
      : `<div class="empty-box"><b>没有匹配的课件档案</b>${state.q ? '换个关键词试试。' : '去「发起制作」提一个课件需求。'}</div>`}
  </div>`
}

function bindArchives() {
  const search = document.getElementById('a-search')
  // 搜索框每次输入都会重建 DOM，渲染完把焦点和光标放回原位，否则打第二个字就丢焦点
  search?.addEventListener('input', async () => {
    state.q = search.value
    await render()
    const next = document.getElementById('a-search')
    if (!next) return
    next.focus()
    try { next.setSelectionRange(next.value.length, next.value.length) } catch { /* 不支持就只给焦点 */ }
  })
  app.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm('删除这份课件档案？（可从历史恢复，你工作区里的课件源文件不受影响）')) return
      try {
        await post('/api/archive/remove', { id: btn.dataset.del })
      } catch (err) {
        toast('删除失败：' + (err.message || err))
        return
      }
      toast('已删除')
      render()
    }))
  app.querySelectorAll('.card[data-id]').forEach((card) =>
    card.addEventListener('click', async (e) => {
      if (e.target.closest('button') || e.target.closest('a')) return
      const id = card.dataset.id
      try {
        const { archive } = await api(`/api/archive?id=${encodeURIComponent(id)}`)
        openViewer(`课件档案 · ${archive.title}`,
          [`标题：${archive.title}（${archive.subject} · ${archive.grade}${archive.sample ? ' · 内置示例' : ''}）`,
            `播放器标题：${archive.deckTitle}`,
            `页面（${archive.pageCount}）：${(archive.pages || []).join('、') || '—'}`,
            `配色：${archive.colors ? `${archive.colors.bg} / ${archive.colors.ink} / ${archive.colors.accent}` : '—'}`,
            `教学目标：${archive.goal || '—'}`,
            `打包：${archive.packed ? `${kb(archive.packBytes)} 单文件（双击即开、断网可用）` : '未打包单文件'}`,
            `检查结果：${archive.checkWarns ? `${archive.checkWarns} 条提醒` : '干净'}`,
            `备注：${archive.note || '—'}`,
            `存档文件：${(archive.files || []).join(', ') || '—'}`,
          ].join('\n'))
      } catch (err) { toast(String(err.message || err)) }
    }))
}

// ---------------------------------------------------------------- 课件预览

function viewPreview(c) {
  const archives = c.archives || []
  const current = archives.find((a) => a.id === state.previewId) || archives[0]
  const server = c.server || {}
  const file = state.previewFile === 'packed' && current?.packed ? '课件.html' : 'index.html'
  const url = current ? `${server.base}/${encodeURIComponent(current.id)}/${encodeURIComponent(file)}` : ''
  return `
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">LIVE PREVIEW</div>
      <h1>课件预览</h1>
      <p>下面是<b>真实播放器</b>在放映课件（学生/老师视角：左右方向键翻页、进度条、目录、全屏、静音都在）。</p>
    </div>
    <div class="toolbar">
      <select id="p-archive" style="max-width:300px">${archives.map((a) =>
        `<option value="${esc(a.id)}" ${current?.id === a.id ? 'selected' : ''}>${esc(a.title)}（${a.pageCount} 页）</option>`).join('') || '<option>（暂无课件）</option>'}</select>
      <button class="pill" id="p-file" aria-pressed="${state.previewFile === 'packed'}" ${current?.packed ? '' : 'disabled'} title="切换单文件版（全部页面内嵌进一个 HTML）">单文件版</button>
      <span class="grow"></span>
      ${server.up ? badge(true, `服务 :${server.port}`) : '<span class="badge gold">服务未启动</span>'}
      <button class="btn small" data-serve ${server.up ? 'disabled' : ''}>${server.up ? '服务运行中' : '启动预览服务'}</button>
      ${server.up && current
        ? `<a class="btn small ghost" href="${esc(url)}" target="_blank" rel="noreferrer">新窗口打开</a>`
        : '<button class="btn small ghost" disabled title="先启动预览服务">新窗口打开</button>'}
    </div>
    ${current ? `
      ${server.up
        ? `<div class="preview-stage"><iframe class="preview-frame" id="p-frame" src="${esc(url)}" title="课件预览" allow="fullscreen; autoplay"></iframe></div>
           <div class="preview-note" style="margin-top:8px">${esc(url)}　｜　先点一下预览区再按快捷键：翻页 ← →（或点底栏箭头）；目录 g；全屏 f；静音 m</div>`
        : `<div class="empty-box"><b>预览服务没在跑</b>点上面的「启动预览服务」（秒级启动），起来后这里会自动加载课件。</div>`}
    ` : `<div class="empty-box"><b>还没有可预览的课件</b>agent 交付并 courseware save 存证后，这里会出现预览。</div>`}
  </div>`
}

function bindPreview() {
  const archiveSel = document.getElementById('p-archive')
  archiveSel?.addEventListener('change', () => { state.previewId = archiveSel.value; state.previewFile = 'index.html'; render() })
  document.getElementById('p-file')?.addEventListener('click', (e) => {
    state.previewFile = state.previewFile === 'packed' ? 'index.html' : 'packed'
    e.currentTarget.setAttribute('aria-pressed', String(state.previewFile === 'packed'))
    render()
  })
  // 预览在另一个端口（跨域 iframe），翻页快捷键只在 iframe 拿到焦点后才生效
  const frame = document.getElementById('p-frame')
  if (frame) {
    const focusFrame = () => { try { frame.contentWindow?.focus() } catch { /* 跨域拿不到就靠用户点 */ } }
    frame.addEventListener('load', focusFrame)
    focusFrame()
  }
}

// ---------------------------------------------------------------- 档案历史

function viewHistory(c) {
  const kinds = ['all', 'create', 'update', 'delete', 'restore']
  // 类型筛选在前端做：catalog 一次带回最近 60 条，点 pill 立刻生效（不用再打一次接口）
  const all = c.history || []
  const list = state.kind === 'all' ? all : all.filter((e) => e.kind === state.kind)
  return `
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">HISTORY</div>
      <h1>档案历史</h1>
      <p>存证 / 更新 / 删除 / 恢复都会留痕（每次存证是一版）；删掉的档案带完整快照，可一键恢复。</p>
    </div>
    <div class="toolbar">
      ${kinds.map((k) => `<button class="pill" data-kind="${k}" aria-pressed="${state.kind === k}">${k === 'all' ? '全部' : kindLabel(k)}</button>`).join('')}
      <span class="grow"></span>
      <button class="btn small danger" id="h-clear">清空历史</button>
    </div>
    ${list.length ? list.map((e) => `
      <div class="hrow" data-event="${esc(e.id)}" data-kind="${esc(e.kind)}">
        <span class="when">${shortTime(e.at)}</span>
        <span class="badge ${KIND_TONE[e.kind] || ''}">${kindLabel(e.kind)}</span>
        <span class="what"><b>${esc(e.title || e.archiveId)}</b><div>${esc(e.summary || '')}</div></span>
        ${e.kind === 'delete' ? '<button class="btn small ghost" data-restore="' + esc(e.id) + '">恢复</button>' : ''}
      </div>`).join('')
      : `<div class="empty-box"><b>${state.kind === 'all' ? '还没有历史记录' : `没有「${kindLabel(state.kind)}」记录`}</b>${state.kind === 'all' ? '存证 / 删除之后这里会留痕。' : '切到「全部」看看其他类型的记录。'}</div>`}
  </div>`
}

function bindHistory() {
  app.querySelectorAll('.pill[data-kind]').forEach((pill) =>
    pill.addEventListener('click', () => { state.kind = pill.dataset.kind; render() }))
  document.getElementById('h-clear')?.addEventListener('click', async () => {
    if (!confirm('清空全部历史？（不影响课件档案）')) return
    try {
      await post('/api/history/clear')
    } catch (err) {
      toast('清空失败：' + (err.message || err))
      return
    }
    toast('已清空')
    render()
  })
  app.querySelectorAll('[data-restore]').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      try {
        const out = await post('/api/archive/restore', { eventId: btn.dataset.restore })
        toast(out.summary || '已恢复')
        render()
      } catch (err) { toast(String(err.message || err)) }
    }))
}

// ---------------------------------------------------------------- 制作规范

const GUIDE = [
  ['八条硬性规则', [
    '① 页面只放内容——课程标题栏、页码、进度条、翻页按钮、静音按钮全部由播放器提供；',
    '② 播放器用原文——index.html 就是 player.html，只改 DECK 这一个对象；',
    '③ 每一页从页面骨架起头——「配色/骨架和部件/公共脚本」三段每页一字不差，只写「本页样式/内容/脚本」；',
    '④ 颜色只有三样——一个底色、一种强调色、黑白灰文字；本页样式与 SVG 只写 var(--…)；',
    '⑤ 一屏一页，主体要大——横屏不滚动，图示互动区撑满内容区，尺寸用 rem；',
    '⑥ 游戏按内容判断——机制即知识：游戏里反复做的动作就是知识点的思维动作，剥掉皮只剩选择题就重做；',
    '⑦ 3D 默认不用——只有立体结构、空间关系非 3D 不可时才用，一节课不超过两三页；',
    '⑧ 不用 Emoji，不用外链图片——图标插图一律内联 SVG。',
  ]],
  ['页面类型与节奏', [
    '封面页（立概念，deck(\'next\') 开始）→ 导入页（先猜再揭晓）→ 讲解页（一页一个概念，分步揭示）→',
    '探索页（可操作模型）→ 练习页（小游戏 2–4 分钟）→ 挑战页（综合关卡）→ 总结页（stars.total() 收束）。',
    '连续讲解不超过两页就要让学员动一次手；互动要有理由：去掉后学习效果不变就去掉。',
  ]],
  ['手感与反馈', [
    '四个状态：开场规则一句话 → 进行 → 即时反馈 → 结算记星（stars.save(\'07\', 3)）。',
    '答对 sfx(\'ok\')+fx(pop)；答错 sfx(\'no\')+fx(shake)，反馈写进页面 .note 区，说清错在哪、允许立刻重试。',
    '提示三级：方法 → 线索 → 答案。不锁翻页（老师随时能跳）。',
    '用 hidden 藏元素时本页样式必须带 [hidden]{display:none!important} 兜底。',
  ]],
  ['输入方式', [
    '拖拽用 Pointer Events + setPointerCapture + touch-action:none（HTML5 原生拖放触屏不可用）；',
    '可点区域 ≥48px；关键信息不藏悬停；游戏用方向键时 preventDefault() 防误触翻页。',
  ]],
  ['内容与逻辑分离', [
    '题库/文案/关卡配置集中在「本页脚本」顶部带中文注释的常量对象里，老师不懂代码也能改题；',
    '同一教具跨页复用时读数全课一致（第 3 页称的石头，第 4、5 页数字一个都不能变）。',
  ]],
  ['配色速查（九值抄进骨架）', [
    '黑+黄 #000000/#131313/#222222/#FFFFFF/#B9B9B9/#7C7C7C/rgba(255,255,255,.14)/#FFD23F/#1A1400 —— 强烈醒目、星空光学舞台；',
    '暖白+朱橙 #F6F1E7/#FFFDF8/#EBE4D6/#1F1B16/#5A544A/#736D62/rgba(31,27,22,.14)/#C4411A/#FFFFFF —— 语文历史生活；',
    '雾白+钴蓝 #F2F4F6/#FFFFFF/#E4E8EC/#14171C/#4D5560/#68717D/rgba(20,23,28,.12)/#2F5BEA/#FFFFFF —— 数理信息；',
    '米白+松绿 #F4F2EC/#FFFFFF/#E6E3DA/#1B1D1A/#53574F/#6C7067/rgba(27,29,26,.13)/#1F7A5C/#FFFFFF —— 生物地理自然。',
  ]],
  ['交付闭环', [
    '写页面 → courseware check（硬错误必须清零；警告按交付前自查逐条修）→ courseware pack 打包 课件.html',
    '→ courseware save 存证 → courseware serve 启动预览 → 本面板「课件预览」翻页验一遍。',
  ]],
]

function viewGuide() {
  return `
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">METHOD</div>
      <h1>制作规范</h1>
      <p>interactive-courseware 技能的要点速查——完整方法论在技能目录里（SKILL.md 原文随插件分发，agent 创作时按需加载）。</p>
    </div>
    ${GUIDE.map(([title, items]) => `
      <div class="panel">
        <h2>${esc(title)}</h2>
        <ul style="margin:8px 0 0;padding-left:18px;color:var(--ink-2);font-size:12.5px;line-height:1.9">
          ${items.map((i) => `<li>${esc(i)}</li>`).join('')}
        </ul>
      </div>`).join('')}
    <div class="note" style="margin-top:12px">
      本插件基于 interactive-courseware 技能（threejs-ware）的本地化应用；示例课件版权归作者所有，二次分发请遵守仓库许可约定。
    </div>
  </div>`
}

// ---------------------------------------------------------------- 启动

addEventListener('hashchange', render)
render()
