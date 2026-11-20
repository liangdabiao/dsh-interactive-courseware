// 课件放映厅 · 看板数据面：/dsh-interactive-courseware 前缀路由。
//   GET  /                       工作台页面（lab/ 静态资源）
//   GET  /api/catalog            档案列表 + 历史统计 + 服务状态 + 技能目录（含内置示例种子等待）
//   GET  /api/archive?id=        档案详情（含预览地址：完整播放器 / 单文件版）
//   GET  /api/archive/source?id=&file=   读回存档的页面源码（*.html 白名单）
//   POST /api/archive/remove     删档案（留删除快照）
//   POST /api/archive/restore    从删除快照恢复
//   POST /api/history/clear      清空历史
//   GET  /api/history?kind=&q=   档案历史
//   GET  /api/status             预览服务状态（面板轮询用）
//   POST /api/serve              启动预览服务
//   GET  /api/preview?id=&file=  计算预览地址（面板 iframe 用）
import { fileURLToPath } from 'node:url'
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { readDir } from './skills.js'
import { readArchivedFile } from './archive.js'
import {
  KIND_LABEL, GRADES, SUBJECTS, archiveSummary, clearHistory, deleteArchive,
  getArchive, listArchives, listArchiveHistory, restoreFromHistory, stats,
} from './archive.js'
import { previewUrl, serverHealth, startServer } from './serve.js'

const BASE = '/dsh-interactive-courseware'
const LAB = fileURLToPath(new URL('../lab/', import.meta.url))
const SKILL_DIRS = [fileURLToPath(new URL('../skills/', import.meta.url))]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.md': 'text/markdown; charset=utf-8'
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false // dsh 0.2.x 宿主已 token 鉴权，服务缺席时放行（fail-closed 会把面板永久 403）
  return connection.requestRejection({ headers: req.headers })
}

// 只放行 lab/ 里的文件：拒绝 ..、点开头的路径和指到目录外的符号链接
function safeLabFile(rel) {
  if (!rel || String(rel).split('/').some((p) => p.startsWith('.'))) return null
  let base
  try { base = realpathSync(LAB) } catch { return null }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

function serve(req, res, file) {
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-cache'
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

// 只接受同源页面发来的 JSON
function readJson(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const origin = req.headers.origin
    if (req.method !== 'POST') return reject(Object.assign(new Error('method'), { status: 405 }))
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('需要 JSON'), { status: 415 }))
    if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return reject(Object.assign(new Error('origin'), { status: 403 }))
    let size = 0
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > max) req.destroy(); else chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(Object.assign(e, { status: 400 })) } })
    req.on('error', reject)
  })
}

function skillCatalog() {
  return SKILL_DIRS.flatMap((dir) => readDir(dir)).map((s) => ({
    name: s.name,
    description: s.description,
    dirName: s.dirName,
    bodyChars: String(s.body || '').length
  }))
}

export function registerApi(ctx, { configRef }) {
  const getCfg = () => {
    const cfg = configRef.config || {}
    return { port: Number(cfg.previewPort) || 5100, version: cfg._version }
  }
  const waitSeed = async () => {
    try { await configRef.seedPromise } catch { /* 种子失败不拖垮面板 */ }
  }

  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      const cfg = getCfg()
      try {
        const rejection = requestRejection(ctx, req)
        if (typeof rejection === 'number') return json(res, rejection, { error: '未授权' })

        const url = new URL(req.url, 'http://x')
        const path = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'

        // ---- API ----
        if (path === '/api/ping' && req.method === 'GET') return json(res, 200, { ok: true, version: cfg.version })
        if ((path === '/api/health' || path === '/health') && req.method === 'GET') return json(res, 200, { ok: true, version: cfg.version })

        if (path === '/api/status' && req.method === 'GET') {
          const health = await serverHealth(cfg.port)
          return json(res, 200, { ok: true, server: { port: cfg.port, up: health.up, base: `http://127.0.0.1:${cfg.port}` } })
        }

        if (path === '/api/catalog' && req.method === 'GET') {
          await waitSeed()
          const health = await serverHealth(cfg.port)
          return json(res, 200, {
            ok: true,
            version: cfg.version,
            server: { port: cfg.port, up: health.up, base: `http://127.0.0.1:${cfg.port}` },
            archives: listArchives().map(archiveSummary),
            history: listArchiveHistory({ limit: 60 }),
            stats: stats(),
            kinds: KIND_LABEL,
            subjects: SUBJECTS,
            grades: GRADES,
            skills: skillCatalog()
          })
        }

        if (path === '/api/archive' && req.method === 'GET') {
          await waitSeed()
          const archive = getArchive(url.searchParams.get('id') || '')
          if (!archive) return json(res, 404, { ok: false, error: '没有这份课件档案' })
          return json(res, 200, {
            ok: true,
            archive,
            preview: previewUrl(cfg.port, archive.id, 'index.html'),
            previewPacked: previewUrl(cfg.port, archive.id, '课件.html'),
          })
        }

        if (path === '/api/archive/source' && req.method === 'GET') {
          const archive = getArchive(url.searchParams.get('id') || '')
          if (!archive) return json(res, 404, { ok: false, error: '没有这份课件档案' })
          // 存档时 archive.dir 已是实际落盘目录；file 白名单在 readArchivedFile 里卡
          const body = readArchivedFile(archive.dir, url.searchParams.get('file') || '')
          if (body === null) return json(res, 404, { ok: false, error: '源文件不在存档里（只归档 index.html / page-*.html / 课件.html）' })
          return json(res, 200, { ok: true, file: url.searchParams.get('file'), body })
        }

        if (path === '/api/history' && req.method === 'GET') {
          const list = listArchiveHistory({
            kind: url.searchParams.get('kind') || 'all',
            q: url.searchParams.get('q') || '',
            limit: url.searchParams.get('limit') || 100
          })
          return json(res, 200, { ok: true, list, kinds: KIND_LABEL })
        }

        if (path === '/api/archive/remove' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          const removed = deleteArchive(String(body.id || ''))
          return json(res, removed ? 200 : 404, { ok: Boolean(removed), id: body.id, error: removed ? undefined : '没有这份课件档案' })
        }

        if (path === '/api/archive/restore' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          const archive = restoreFromHistory(String(body.eventId || ''))
          if (!archive) return json(res, 400, { ok: false, error: '这条记录没有可恢复的快照' })
          return json(res, 200, { ok: true, archive: archiveSummary(archive), summary: `已恢复「${archive.title}」` })
        }

        if (path === '/api/history/clear' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          clearHistory()
          return json(res, 200, { ok: true })
        }

        if (path === '/api/serve' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          const outcome = await startServer(cfg.port)
          return json(res, 200, { ...outcome, ok: Boolean(outcome.ok) })
        }

        if (path === '/api/preview' && req.method === 'GET') {
          const archive = getArchive(url.searchParams.get('id') || '')
          if (!archive) return json(res, 404, { ok: false, error: '没有这份课件档案' })
          const file = url.searchParams.get('file') || 'index.html'
          return json(res, 200, { ok: true, url: previewUrl(cfg.port, archive.id, file) })
        }

        if (path.startsWith('/api/')) return json(res, 404, { ok: false, error: 'not found' })

        // ---- 静态页面 ----
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: 'method' })
        const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '')
        const file = safeLabFile(rel)
        return file ? serve(req, res, file) : json(res, 404, { ok: false, error: 'not found' })
      } catch (err) {
        return json(res, 500, { ok: false, error: String(err?.message || '内部错误') })
      }
    },
  })
}
