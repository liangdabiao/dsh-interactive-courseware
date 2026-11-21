// 面板前端（lab/app.js）回归测试：用最小 DOM 桩在 vm 里真跑页面逻辑，不依赖浏览器。
// 覆盖：预览深链 ?id=、历史类型筛选、服务未启动的入口、加载失败重试。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const CODE = readFileSync(new URL('../lab/app.js', import.meta.url), 'utf8')

const CATALOG = {
  ok: true, version: '0.1.0',
  server: { port: 5100, up: true, base: 'http://127.0.0.1:5100' },
  archives: [
    { id: 'deck-A', title: '阿基米德与浮力', deckTitle: '阿基米德与浮力', subject: '物理', grade: '初中', goal: 'g1', pageCount: 8, pages: ['p1'], colors: { bg: '#fff', ink: '#000', accent: '#c4411a' }, packed: true, packBytes: 145001, checkWarns: 0, sample: true, revisions: 1, files: ['index.html'], createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-21T00:00:00Z' },
    { id: 'deck-B', title: '勾股定理双证记', deckTitle: '勾股定理双证记', subject: '数学', grade: '初中', goal: 'g2', pageCount: 9, pages: ['p1'], colors: null, packed: true, packBytes: 148504, checkWarns: 0, sample: false, revisions: 0, files: [], createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z' },
  ],
  history: [
    { id: 'ev-1', at: '2026-11-21T01:00:00Z', kind: 'create', title: 'A', summary: 's1', archiveId: 'deck-A' },
    { id: 'ev-2', at: '2026-11-21T02:00:00Z', kind: 'delete', title: 'B', summary: 's2', archiveId: 'deck-B' },
    { id: 'ev-3', at: '2026-11-21T03:00:00Z', kind: 'restore', title: 'C', summary: 's3', archiveId: 'deck-B' },
  ],
  stats: { archives: 2, pages: 17, packed: 2, events: 3 },
  kinds: { create: '新建', update: '更新', delete: '删除', restore: '恢复' },
  subjects: [], grades: [],
  skills: [{ name: 'interactive-courseware', description: 'd', dirName: 'interactive-courseware', bodyChars: 25549 }],
}

const makeEl = (id = '') => ({
  id, textContent: '', innerHTML: '', value: '', hidden: false, disabled: false, dataset: {}, _on: {},
  classList: { add() {}, remove() {}, contains: () => false },
  addEventListener(ev, fn) { this._on[ev] = fn },
  removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
  querySelectorAll: () => [], focus() {}, setSelectionRange() {},
  contentWindow: { focus() {} },
})

// 每个场景一个全新 vm 沙箱（app.js 是经典脚本，重跑会重复声明 const）
function scenario({ hash = '#/', catalog = CATALOG, fail = false } = {}) {
  const els = new Map()
  const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id) }
  const app = getEl('app')
  const posted = [] // 面板发给宿主的 postMessage（发起制作）

  // 让 bindHistory 能拿到「真绑了 handler」的类型 pill（同一份 DOM 缓存同一批桩）
  let cacheKey = null
  let cache = []
  app.querySelectorAll = (sel) => {
    if (!String(sel).includes('data-kind')) return []
    if (app.innerHTML === cacheKey) return cache
    cacheKey = app.innerHTML
    cache = [...String(app.innerHTML).matchAll(/<button class="pill" data-kind="([a-z]+)"/g)].map((m) => {
      const el = makeEl()
      el.dataset.kind = m[1]
      el._on = {}
      el.addEventListener = (ev, fn) => { el._on[ev] = fn }
      return el
    })
    return cache
  }

  const sandbox = {
    console, URLSearchParams, encodeURIComponent, decodeURIComponent, JSON, Math, Date,
    String, Number, Boolean, Array, Object, Error,
    setTimeout: (fn) => { try { fn && fn() } catch {}; return 0 }, clearTimeout() {}, setInterval: () => 0,
    confirm: () => false,
    navigator: { clipboard: { writeText() {} } },
    location: { hash, pathname: '/dsh-interactive-courseware/', origin: 'http://127.0.0.1:57916' },
    parent: { postMessage: (m) => posted.push(m) },
    document: { getElementById: getEl, querySelectorAll: () => [], documentElement: { dataset: {} } },
    addEventListener() {},
    fetch: async () => (fail
      ? { ok: false, status: 500, json: async () => ({ ok: false, error: '请求失败（500）' }) }
      : { ok: true, status: 200, json: async () => catalog }),
  }
  vm.createContext(sandbox)
  vm.runInContext(CODE, sandbox, { filename: 'lab/app.js' })
  return { app, sandbox, getEl, posted }
}

const tick = () => new Promise((r) => setTimeout(r, 30))
const rows = (html) => [...String(html).matchAll(/data-event="([^"]+)"/g)].map((m) => m[1])

test('预览深链：?id= 选中对应档案，不落到第一份', async () => {
  const { app } = scenario({ hash: '#/preview?id=deck-B' })
  await tick()
  assert.match(app.innerHTML, /\/deck-B\/index\.html/)
  assert.doesNotMatch(app.innerHTML, /\/deck-A\/index\.html/)
})

test('预览页：服务在跑时给「新窗口打开」真链接', async () => {
  const { app } = scenario({ hash: '#/preview?id=deck-A' })
  await tick()
  assert.match(app.innerHTML, /target="_blank"/)
  assert.match(app.innerHTML, /服务运行中/)
})

test('预览页：服务没起时不渲染死链', async () => {
  const { app } = scenario({ hash: '#/preview', catalog: { ...CATALOG, server: { port: 5100, up: false, base: 'http://127.0.0.1:5100' } } })
  await tick()
  assert.doesNotMatch(app.innerHTML, /target="_blank"/)
  assert.match(app.innerHTML, /先启动预览服务/)
})

test('概览页：有「发起制作」主按钮，服务没起可原地启动', async () => {
  const up = scenario({ hash: '#/' })
  await tick()
  assert.match(up.app.innerHTML, /href="#\/new"/)

  const down = scenario({ hash: '#/', catalog: { ...CATALOG, server: { port: 5100, up: false, base: 'http://127.0.0.1:5100' } } })
  await tick()
  assert.match(down.app.innerHTML, /data-serve/)
  assert.match(down.app.innerHTML, /badge gold">未启动/)
  assert.doesNotMatch(down.app.innerHTML, /badge bad">未启动/)
})

test('历史页：类型 pill 真的筛选列表，点回「全部」还原', async () => {
  const { app } = scenario({ hash: '#/history' })
  await tick()
  assert.equal(rows(app.innerHTML).length, 3)

  const pill = (kind) => app.querySelectorAll('.pill[data-kind]').find((p) => p.dataset.kind === kind)
  pill('delete')._on.click()
  await tick()
  assert.deepEqual(rows(app.innerHTML), ['ev-2'])

  pill('restore')._on.click()
  await tick()
  assert.deepEqual(rows(app.innerHTML), ['ev-3'])

  pill('all')._on.click()
  await tick()
  assert.equal(rows(app.innerHTML).length, 3)
})

test('档案页：搜索框与带 id 的预览链接', async () => {
  const { app } = scenario({ hash: '#/archives' })
  await tick()
  assert.match(app.innerHTML, /id="a-search"/)
  assert.match(app.innerHTML, /href="#\/preview\?id=deck-A"/)
  assert.match(app.innerHTML, /href="#\/preview\?id=deck-B"/)
})

test('加载失败：给重试按钮，不是一次性死页', async () => {
  const { app } = scenario({ hash: '#/', fail: true })
  await tick()
  assert.match(app.innerHTML, /看板加载失败/)
  assert.match(app.innerHTML, /id="retry"/)
})

test('发起制作：指令以「课件放映厅：」开头，带上需求与技能名', async () => {
  const { getEl, posted } = scenario({ hash: '#/new' })
  await tick()

  const topic = getEl('f-topic')
  topic.value = '做一节月相成因的互动课，学生能拖动月亮'
  topic._on.input()
  assert.match(getEl('f-prompt').value, /^课件放映厅：/, '预览指令也要带抬头')

  getEl('f-start')._on.click()
  const msg = posted.find((m) => m.type === 'dsh-interactive-courseware:start')
  assert.ok(msg, '点「发起制作」要把指令 postMessage 给宿主')
  assert.match(msg.prompt, /^课件放映厅：/, '开头的「课件放映厅：」不能被丢掉')
  assert.match(msg.prompt, /interactive-courseware/)
  assert.match(msg.prompt, /月相成因/)
})
