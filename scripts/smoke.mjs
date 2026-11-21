// 课件放映厅 · E2E 冒烟：courseware 工具全动作跑通（沙盒 DSH_HOME + 沙盒课件目录）。
// 用法：node scripts/smoke.mjs [--port <端口>]（不给端口就自动挑一个空闲端口，避开正在运行的插件实例）
import { cpSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-courseware-smoke-'))
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : fallback
}
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})
const PORT = Number(argOf('--port', 0)) || (await freePort())
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const EXAMPLE = join(PLUGIN_ROOT, 'skills', 'interactive-courseware', 'examples', 'archimedes-buoyancy')

// 真材实料：把内置示例复制到沙盒当「agent 刚做完的课件」
const WORK = join(mkdtempSync(join(tmpdir(), 'dsh-courseware-deck-')), 'archimedes-buoyancy')
cpSync(EXAMPLE, WORK, { recursive: true })
// 把 课件.html 挪走，模拟「还没打包」的状态，让 pack 动作有活干
rmSync(join(WORK, '课件.html'), { force: true })

const { coursewareTool, configRef } = await import('../src/host.js')
// 端口必须写回 host.js 自己的 configRef（工具里 cfg() 读的是它），否则 --port 是空话
configRef.config = { previewPort: PORT }
// 与真实宿主 apply() 同款：先把内置示例种入档案库
const { seedSamples } = await import('../lib/archive.js')
await seedSamples(join(PLUGIN_ROOT, 'skills', 'interactive-courseware', 'examples'))
const run = (args) => coursewareTool.execute(args)

let failed = 0
const step = async (label, args, expectOk = true) => {
  try {
    const out = await run(args)
    const ok = out.ok === expectOk
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${out.summary.split('\n')[0]}${out.data ? `\n      ${String(out.data).split('\n')[0]}` : ''}`)
    if (!ok) failed++
    return out
  } catch (err) {
    console.log(`FAIL  ${label}\n      抛错：${err.message}`)
    failed++
    return null
  }
}

console.log(`== courseware 冒烟（work=${WORK} port=${PORT}）==`)
await step('scaffold 空目录落三段固定代码', { action: 'scaffold', dir: join(dirname(WORK), 'fresh-deck') })
await step('scaffold 已存在不覆盖', { action: 'scaffold', dir: WORK })
await step('check 未完成目录（应失败：缺 index.html）', { action: 'check', dir: join(dirname(WORK), 'fresh-deck') }, false)
await step('check 示例课件（机械盘点）', { action: 'check', dir: WORK })
await step('pack 打包单文件', { action: 'pack', dir: WORK })
const packedOk = existsSync(join(WORK, '课件.html')) && statSync(join(WORK, '课件.html')).size > 100 * 1024
console.log(`${packedOk ? 'PASS' : 'FAIL'}  课件.html 真实落盘且 >100KB`)
if (!packedOk) failed++
await step('check 打包后盘点（应提示可直接 save）', { action: 'check', dir: WORK })
await step('pack 缺页面目录（应失败）', { action: 'pack', dir: join(dirname(WORK), 'no-such-dir') }, false)
await step('save 课件存证', {
  action: 'save', dir: WORK, subject: '物理', grade: '初中',
  goal: '用一缸水破「王冠掺银」悬案：排水法测体积，浮力 = 排开液体的重', note: '冒烟测试存证',
})
const archives = (await import('../lib/archive.js')).listArchives()
const id = archives.find((a) => !a.sample)?.id
if (!id) { console.log('FAIL  save 后档案库为空'); failed++ }
await step('archive 档案列表（含内置示例）', { action: 'archive' })
const sampleSeeded = archives.some((a) => a.sample)
console.log(`${sampleSeeded ? 'PASS' : 'FAIL'}  内置示例已种入档案库`)
if (!sampleSeeded) failed++
await step('get-archive 档案详情', { action: 'get-archive', id })
const saved = await step('save 同目录再存一版', { action: 'save', dir: WORK, note: '第二版' })
await step('serve 启动预览服务', { action: 'serve', id })
await step('serve 单文件版预览', { action: 'serve', id, file: '课件.html' })
await step('history 历史', { action: 'history' })
await step('delete 删除档案', { action: 'delete', id, confirm: 'yes' })
const events = (await import('../lib/archive.js')).listArchiveHistory({ kind: 'delete' })
await step('restore 恢复', { action: 'restore', eventId: events[0]?.id })
await step('restore 无效 eventId（应失败）', { action: 'restore', eventId: 'ev-nope' }, false)
await step('delete 缺 confirm（应失败）', { action: 'delete', id }, false)

// 真实预览可达性（serve 出来的完整播放器页）
const url = `http://127.0.0.1:${PORT}/${id}/index.html`
try {
  const res = await fetch(url)
  const html = await res.text()
  const hit = res.ok && html.includes('const DECK') && html.includes('课件播放器外壳')
  console.log(`${hit ? 'PASS' : 'FAIL'}  预览服务真实可达 ${url}（HTTP ${res.status}${hit ? '，含播放器外壳' : ''}）`)
  if (!hit) failed++
} catch (err) {
  console.log(`FAIL  预览服务：${err.message}`)
  failed++
}
// 单文件版可达且自包含
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/${encodeURIComponent(id)}/${encodeURIComponent('课件.html')}`)
  const html = await res.text()
  const { packedSelfContained } = await import('../lib/pack.js')
  const hit = res.ok && packedSelfContained(html)
  console.log(`${hit ? 'PASS' : 'FAIL'}  单文件版自包含（src 引用已被页面全文替换）`)
  if (!hit) failed++
} catch (err) {
  console.log(`FAIL  单文件版：${err.message}`)
  failed++
}

console.log(`\n== ${failed ? `${failed} 项失败` : '全部通过'}；沙盒：${process.env.DSH_HOME}（不清理，留查证） ==`)
process.exit(failed ? 1 : 0)
