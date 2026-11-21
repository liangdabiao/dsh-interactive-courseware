// 课件放映厅 · 课件档案 + 历史持久化（$DSH_HOME/dsh-interactive-courseware/）。
//
//   archives.json  [{ id, title, subject, grade, goal, note, deckTitle, colors{},
//                     pages[], pageCount, packed, packBytes, checkWarns, sample,
//                     dir, files[], createdAt, updatedAt, revisions[] }]
//   history.json   [{ id, at, kind: create|update|delete|restore, archiveId, title,
//                     pageCount, rev, summary, snapshot? }]
//
// 每次 save 都多一版（revisions，最多 20 版）；保存/删除/恢复都写 history。
// 内置示例（skills/…/examples/）首次启动种入档案库，之后与普通档案无差别（可删）。
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-interactive-courseware')
export const DECKS_DIR = join(DATA_DIR, 'decks')
const ARCHIVE_FILE = join(DATA_DIR, 'archives.json')
const HIST_FILE = join(DATA_DIR, 'history.json')
const SEED_FILE = join(DATA_DIR, 'samples-seeded')
const MAX_ARCHIVES = 100
const MAX_REVISIONS = 20
const MAX_HISTORY = 300

export const KIND_LABEL = { create: '新建', update: '更新', delete: '删除', restore: '恢复' }
export const SUBJECTS = ['数学', '语文', '物理', '化学', '生物', '地理', '历史', '信息科技', '其他']
export const GRADES = ['小学', '初中', '高中', '大学', '通识']

export function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(DECKS_DIR)) mkdirSync(DECKS_DIR, { recursive: true })
}

// 原子写：先 .tmp 再 rename，面板轮询时不会读到半截 JSON。
function writeJson(file, value) {
  ensureDirs()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    renameSync(tmp, file)
  } catch (err) {
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    throw err
  }
}

function readJson(file, fallback) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return raw ?? fallback
  } catch {
    return fallback
  }
}

function load() {
  const raw = readJson(ARCHIVE_FILE, [])
  return Array.isArray(raw) ? raw : []
}

function save(list) {
  writeJson(ARCHIVE_FILE, list.slice(0, MAX_ARCHIVES))
}

function loadHistory() {
  const raw = readJson(HIST_FILE, [])
  return Array.isArray(raw) ? raw : []
}

function pushHistory(event) {
  const list = loadHistory()
  list.unshift(event)
  writeJson(HIST_FILE, list.slice(0, MAX_HISTORY))
}

const now = () => new Date().toISOString()
const id4 = () => Math.random().toString(36).slice(2, 6)

// host 在复制课件文件前先要一个档案 id（目录名依赖它）；saveArchive 传入同一 id 就不会再生成
export function newArchiveId() {
  return `deck-${now().slice(0, 10).replace(/-/g, '')}-${id4()}`
}

function normalizePages(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean).slice(0, 60)
  if (typeof value === 'string') return value.split(/[,，;；\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 60)
  return []
}

// ---------------------------------------------------------------- 档案

export function archiveSummary(a) {
  return {
    id: a.id, title: a.title, deckTitle: a.deckTitle || a.title,
    subject: a.subject, grade: a.grade, goal: a.goal || '', note: a.note || '',
    colors: a.colors || null,
    pages: a.pages, pageCount: (a.pages || []).length,
    packed: Boolean(a.packed), packBytes: a.packBytes || 0, checkWarns: a.checkWarns || 0,
    sample: Boolean(a.sample),
    files: a.files || [], fileCount: (a.files || []).length,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
    revisions: (a.revisions || []).length,
  }
}

// 保存课件档案（id 相同 = 覆盖更新，多一版 revision）。sourceDir 是已复制好课件文件的目录。
// originDir 是 agent 的工作目录：同一个目录再次 save 视为「改一版」，复用同一条档案。
export function saveArchive({ id, title, deckTitle, subject, grade, goal, pages, colors, packed, packBytes, checkWarns, sample, sourceDir, originDir, files, note }) {
  if (!title || !String(title).trim()) throw new Error('课件标题（title）不能为空。')
  const list = load()
  const pagesNorm = normalizePages(pages)
  const entry = {
    id: (id && list.some((a) => a.id === id) ? id : (id || newArchiveId())),
    title: String(title).trim(),
    deckTitle: String(deckTitle || title).trim(),
    subject: SUBJECTS.includes(subject) ? subject : '其他',
    grade: GRADES.includes(grade) ? grade : '通识',
    goal: String(goal || '').trim(),
    note: String(note || '').trim(),
    pages: pagesNorm,
    colors: colors && typeof colors === 'object' ? { bg: colors.bg, ink: colors.ink, accent: colors.accent } : null,
    packed: Boolean(packed),
    packBytes: Number.isFinite(Number(packBytes)) ? Number(packBytes) : 0,
    checkWarns: Number.isFinite(Number(checkWarns)) ? Number(checkWarns) : 0,
    sample: Boolean(sample),
    dir: sourceDir,
    originDir: String(originDir || '').trim(),
    files: Array.isArray(files) ? files : [],
    createdAt: now(), updatedAt: now(),
    revisions: [],
  }
  const existing = id ? list.find((a) => a.id === id) : null
  if (existing) {
    entry.id = existing.id
    entry.createdAt = existing.createdAt
    entry.revisions = [...(existing.revisions || []), {
      rev: (existing.revisions || []).length + 1, at: now(), kind: 'update',
      title: existing.title, note: entry.note || '覆盖更新',
    }].slice(-MAX_REVISIONS)
    Object.assign(existing, entry)
    save(list)
    pushHistory({ id: `ev-${now().replace(/\W/g, '')}-${id4()}`, at: now(), kind: 'update', archiveId: existing.id, title: existing.title, pageCount: pagesNorm.length, rev: entry.revisions.length, summary: entry.note || '更新课件' })
    return { archive: existing, created: false }
  }
  list.unshift(entry)
  save(list)
  pushHistory({ id: `ev-${now().replace(/\W/g, '')}-${id4()}`, at: now(), kind: 'create', archiveId: entry.id, title: entry.title, pageCount: pagesNorm.length, rev: 0, summary: `新建课件档案（${entry.subject} · ${entry.grade}，${pagesNorm.length} 页${entry.packed ? '，已打包' : ''}）` })
  return { archive: entry, created: true }
}

export function listArchives() {
  return load()
}

export function getArchive(id) {
  return load().find((a) => a.id === id) || null
}

// 同一个课件工作目录再次 save 时复用已有档案（Windows 路径大小写/斜杠不敏感）。
function originKey(dir) {
  const value = String(dir || '').trim()
  if (!value) return ''
  try { return resolve(value).toLowerCase() } catch { return value.toLowerCase() }
}

export function findArchiveByOrigin(dir) {
  const key = originKey(dir)
  if (!key) return null
  return load().find((a) => a.originDir && originKey(a.originDir) === key) || null
}

export function deleteArchive(id) {
  const list = load()
  const index = list.findIndex((a) => a.id === id)
  if (index === -1) return null
  const [removed] = list.splice(index, 1)
  save(list)
  pushHistory({ id: `ev-${now().replace(/\W/g, '')}-${id4()}`, at: now(), kind: 'delete', archiveId: removed.id, title: removed.title, pageCount: (removed.pages || []).length, rev: (removed.revisions || []).length, summary: '删除课件档案（留快照可恢复）', snapshot: removed })
  return removed
}

export function restoreFromHistory(eventId) {
  const event = loadHistory().find((e) => e.id === eventId)
  if (!event || event.kind !== 'delete' || !event.snapshot) return null
  const list = load()
  if (list.some((a) => a.id === event.snapshot.id)) return event.snapshot // 已存在就不重复插
  list.unshift(event.snapshot)
  save(list)
  pushHistory({ id: `ev-${now().replace(/\W/g, '')}-${id4()}`, at: now(), kind: 'restore', archiveId: event.snapshot.id, title: event.snapshot.title, pageCount: (event.snapshot.pages || []).length, rev: (event.snapshot.revisions || []).length, summary: '从删除快照恢复' })
  return event.snapshot
}

export function listArchiveHistory({ kind = 'all', q = '', limit = 20 } = {}) {
  let events = loadHistory()
  if (kind !== 'all') events = events.filter((e) => e.kind === kind)
  if (q) {
    const needle = q.toLowerCase()
    events = events.filter((e) => `${e.title} ${e.summary} ${e.archiveId}`.toLowerCase().includes(needle))
  }
  return events.slice(0, Math.min(100, Number(limit) || 20))
}

export function clearHistory() {
  writeJson(HIST_FILE, [])
}

export function stats() {
  const list = load()
  const events = loadHistory()
  const subjects = {}
  const grades = {}
  for (const a of list) {
    subjects[a.subject] = (subjects[a.subject] || 0) + 1
    grades[a.grade] = (grades[a.grade] || 0) + 1
  }
  const pages = list.reduce((n, a) => n + (a.pages || []).length, 0)
  return {
    archives: list.length,
    pages,
    packed: list.filter((a) => a.packed).length,
    events: events.length,
    lastEventAt: events[0]?.at || null,
    subjects, grades,
  }
}

export function archiveDirFor(id) {
  return join(DECKS_DIR, id)
}

// ---------------------------------------------------------------- 课件文件归档

// 复制课件交付物（index.html / page-*.html / 课件.html）入档案库，返回文件清单。
// 工作区里的脚手架（page-template.html / pack.py / player.html）不属于交付物，不归档。
export function copyDeckSource(srcDir, destDir) {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
  const files = []
  for (const name of ['index.html', '课件.html']) {
    const from = join(srcDir, name)
    if (existsSync(from)) { copyFileSync(from, join(destDir, name)); files.push(name) }
  }
  const pageRe = /^page-\d+\.html$/
  let pages = 0
  for (const name of listDir(srcDir)) {
    if (pageRe.test(name)) { copyFileSync(join(srcDir, name), join(destDir, name)); files.push(name); pages++ }
  }
  return { files, pages }
}

function listDir(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

// 读回存档里的页面源码（白名单：*.html），拒绝穿越路径
export function readArchivedFile(dir, file) {
  const name = String(file || '')
  if (!/^[\w\u4e00-\u9fff-]+\.html$/.test(name)) return null
  const target = join(dir, name)
  if (!target.startsWith(join(dir, '')) || !existsSync(target)) return null
  try {
    return readFileSync(target, 'utf8')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 内置示例种子

// 首次启动把插件内置示例种入档案库（普通档案，可删，删了不复活）。
export async function seedSamples(examplesDir) {
  ensureDirs()
  if (existsSync(SEED_FILE)) return []
  writeFileSync(SEED_FILE, now(), 'utf8')
  const samples = [
    { dir: join(examplesDir, 'archimedes-buoyancy'), title: '阿基米德与浮力', subject: '物理', grade: '初中',
      goal: '用一缸水破「王冠掺银」悬案：排水法测体积，浮力 = 排开液体的重', note: '内置示例（来自 threejs-ware 成品课件）' },
    { dir: join(examplesDir, 'pythagoras-two-proofs'), title: '勾股定理双证记', subject: '数学', grade: '初中',
      goal: '拼图面积证明 + 欧几里得证明，动手拖拽体会 a²+b²=c²', note: '内置示例（来自 threejs-ware 成品课件）' },
  ]
  const created = []
  for (const s of samples) {
    if (!existsSync(join(s.dir, 'index.html'))) continue
    const id = newArchiveId()
    const dest = archiveDirFor(id)
    const { files } = copyDeckSource(s.dir, dest)
    const packedFile = join(dest, '课件.html')
    const packedBytes = existsSync(packedFile) ? readFileSync(packedFile).length : 0
    // 示例的页面短标题从 index.html 的 DECK 里抠
    let deck = null
    try {
      const { parseDeck } = await import('./deck.js')
      deck = parseDeck(readFileSync(join(s.dir, 'index.html'), 'utf8'))
    } catch { /* 忽略 */ }
    const pages = deck ? deck.pages.map((p) => p.title) : []
    const { archive } = saveArchive({
      id, title: s.title, deckTitle: deck?.title || s.title, subject: s.subject, grade: s.grade,
      goal: s.goal, pages, colors: deck ? { bg: deck.bg, ink: deck.ink, accent: deck.accent } : null,
      packed: true, packBytes: packedBytes, checkWarns: 0, sample: true,
      sourceDir: dest, files, note: s.note,
    })
    created.push(archive)
  }
  return created
}
