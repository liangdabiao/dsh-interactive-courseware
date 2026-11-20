// 课件放映厅 · 预览静态服务：把档案库里的课件目录 serve 给面板 iframe。
// 进程内常驻（课件是纯静态文件，不值得拉独立进程）；健康只信真实 HTTP 探测；
// listen 失败（端口占用等）回滚并如实报错，不留下「假启动」。
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import http from 'node:http'
import { DECKS_DIR } from './archive.js'

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
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
}

const state = { server: null, port: 0 }

// 只放行档案库 decks/ 里的文件：拒绝 ..、点开头的路径和指到目录外的符号链接
function safeDeckFile(rel) {
  if (!rel || String(rel).split(/[\\/]/).some((p) => p.startsWith('.'))) return null
  let base
  try { base = realpathSync(DECKS_DIR) } catch { return null }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x')
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || ''
    const file = safeDeckFile(rel) || (rel && !rel.endsWith('/') ? safeDeckFile(join(rel, 'index.html')) : null)
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end('not found')
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': statSync(file).size,
      'cache-control': 'no-cache',
    })
    if (req.method === 'HEAD') return res.end()
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(500)
    res.end('error')
  }
}

export function serverHealth(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (res) => {
      res.resume()
      resolve({ up: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode })
    })
    req.on('timeout', () => { req.destroy(); resolve({ up: false, statusCode: 0 }) })
    req.on('error', () => resolve({ up: false, statusCode: 0 }))
  })
}

// 启动预览服务。已在跑（真实探测可达）直接返回；listen 失败回滚置空并报错。
export async function startServer(port) {
  const before = await serverHealth(port)
  if (before.up && state.server && state.port === port) {
    return { ok: true, alreadyRunning: true, url: previewBase(port) }
  }
  if (before.up && (!state.server || state.port !== port)) {
    // 端口被别的进程占着且应的不是我们——如实说明，不抢
    return { ok: false, error: `端口 ${port} 已被其他进程占用（健康探测可达但不是本插件的预览服务），换个 previewPort`, url: previewBase(port) }
  }
  await stopServer()
  const server = http.createServer(handler)
  state.server = server
  state.port = port
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
  } catch (err) {
    state.server = null
    state.port = 0
    try { server.close() } catch { /* 已关 */ }
    return { ok: false, error: `预览服务没起来：${err?.message || err}（端口 ${port} 可能被占用，在插件 Config 里换 previewPort）`, url: previewBase(port) }
  }
  const after = await serverHealth(port)
  if (!after.up) {
    try { server.close() } catch { /* 已关 */ }
    state.server = null
    state.port = 0
    return { ok: false, error: '预览服务 listen 后健康探测不通（异常环境），已回滚' }
  }
  return { ok: true, alreadyRunning: false, url: previewBase(port) }
}

export async function stopServer() {
  const server = state.server
  state.server = null
  state.port = 0
  if (!server) return
  try { await new Promise((r) => server.close(r)) } catch { /* 已关 */ }
}

export const previewBase = (port) => `http://127.0.0.1:${port}`

// 课件预览地址：/<archiveId>/index.html（面板 iframe 直接加载完整播放器）
export function previewUrl(port, archiveId, file = 'index.html') {
  return `${previewBase(port)}/${encodeURIComponent(archiveId)}/${encodeURIComponent(file)}`
}
