// 课件放映厅 · Host 半边（技能快照 + courseware 原生工具 + 看板数据面）。
// 工具职责：落三段固定代码 / 机械红线盘点 / 打包单文件 / 课件存证 / 预览服务 / 档案管理。
// 创作本身由 agent 按 interactive-courseware skill 完成（蓝图 → 页面 → 播放器）。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { registerApi } from '../lib/api.js'
import { createSkillProvider } from '../lib/skills.js'
import {
  archiveSummary, archiveDirFor, copyDeckSource, deleteArchive, findArchiveByOrigin, getArchive,
  KIND_LABEL, listArchiveHistory, listArchives, newArchiveId, restoreFromHistory,
  saveArchive, seedSamples,
} from '../lib/archive.js'
import { inspectDeck } from '../lib/deck.js'
import { packDeck } from '../lib/pack.js'
import { scaffoldDeck } from '../lib/scaffold.js'
import { previewUrl, startServer, stopServer } from '../lib/serve.js'

const PLUGIN_VERSION = (() => {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version } catch { return '?' }
})()

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url))
export const name = 'interactive-courseware'

export const inject = ['tools', 'skills', 'webServer', 'connection']

export const Config = Schema.object({
  previewPort: Schema.number().default(5100).description('本地课件预览服务端口（面板 iframe 加载真实播放器）'),
})

export const configRef = { config: null, seedPromise: null }

function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) {
    if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  }
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) {
    if (!spec.properties || !(key in spec.properties)) problems.push(`未知参数 ${key}`)
  }
  if (problems.length) throw new Error(`courseware 参数有误：${problems.join('；')}。`)
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string', description: '给模型看的回执' },
      data: { type: 'string', description: '可选：详情正文' },
    },
  },
  render: (_args, value) => text(value.data ? `${value.summary}\n\n${value.data}` : value.summary),
}

const result = (ok, summary, data = '') => ({ ok, summary, data })

const cfg = () => ({ port: Number(configRef.config?.previewPort) || 5100 })

// ---------------------------------------------------------------------------
// 工具：courseware —— scaffold / check / pack / save / serve / 档案管理
// ---------------------------------------------------------------------------
export const coursewareTool = {
  name: 'courseware',
  description:
    '课件放映厅工具（配合 interactive-courseware 技能使用）：' +
    'scaffold 在课件工作目录落三段固定代码（页面骨架/打包脚本/播放器外壳，只复制不修改）、' +
    'check 机械红线盘点（DECK 解析、页面齐全、title 格式、三段公共一致、色值直写、外链图、Emoji、hidden 兜底——warn 不阻塞，逐条修）、' +
    'pack 打包单文件 课件.html（Node 版 pack.py，无 Python 也能跑）、' +
    'save 课件存证（复制交付物入档案库，用户在侧栏「课件放映厅」翻页预览真实播放器）、' +
    'serve 启动本地预览服务、archive/get-archive/history/delete/restore 档案管理。' +
    '制作课件的标准闭环：蓝图确认后写页面 → check（零 error，warns 尽量清）→ pack → save → serve + 告知用户去面板预览。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('scaffold 落三段固定代码；check 机械红线盘点；pack 打包单文件；save 课件存证；serve 启动预览服务；archive 档案列表；get-archive 档案详情；history 档案历史；delete 删除档案；restore 恢复删除的档案',
        { enum: ['scaffold', 'check', 'pack', 'save', 'serve', 'archive', 'get-archive', 'history', 'delete', 'restore'] }),
      dir: str('scaffold/check/pack/save：课件工作目录（含 index.html 与各 page-XX.html）'),
      title: str('save：课件标题（不传则用 DECK.title）'),
      subject: str('save：学科（数学/语文/物理/化学/生物/地理/历史/信息科技/其他）'),
      grade: str('save：学段（小学/初中/高中/大学/通识）'),
      goal: str('save：教学目标一句话（面板档案卡片显示）'),
      note: str('save：这一版做了什么（写进历史，方便回看）；history：关键词'),
      id: str('save：要覆盖更新的档案 id（不传则按工作目录自动认定是同一份课件的下一版）；serve/get-archive/delete：档案 id（archive 里能看到）'),
      file: str('serve：要预览的文件（默认 index.html 完整播放器；可传 课件.html 看单文件版）'),
      confirm: str('delete 必须传 "yes"', { enum: ['yes'] }),
      kind: str('history：只看某一类事件', { enum: ['all', 'create', 'update', 'delete', 'restore'] }),
      limit: num('history/archive：最多几条，默认 20'),
      eventId: str('restore：历史事件 id（history 里能看到）'),
    },
  },
  output: OUTPUT,
  async execute(args) {
    check(args, this.parameters)
    const { port } = cfg()

    if (args.action === 'scaffold') {
      if (!args.dir) throw new Error('scaffold 需要 dir（课件工作目录，建在你的工作区里）。')
      const out = scaffoldDeck(args.dir)
      const lines = []
      if (out.written.length) lines.push(`已写入：\n  ${out.written.join('\n  ')}`)
      if (out.existing.length) lines.push(`已存在未覆盖：\n  ${out.existing.join('\n  ')}`)
      return result(true,
        `三段固定代码就位（${out.dir}）。接下来：player.html 暂不动（第三阶段复制成 index.html 只改 DECK）；` +
        `每页 cp page-template.html page-0X.html 后只改四处（<title>、本页样式、舞台内容、本页脚本）。`,
        lines.join('\n'))
    }

    if (args.action === 'check') {
      if (!args.dir) throw new Error('check 需要 dir（课件工作目录）。')
      if (!existsSync(args.dir)) return result(false, `目录不存在：${args.dir}`)
      const r = inspectDeck(args.dir)
      const lines = []
      if (r.deck) lines.push(`DECK：${r.deck.title}｜${r.deck.pageCount} 页｜配色 ${r.deck.bg} / ${r.deck.ink} / ${r.deck.accent}`)
      if (r.errors.length) lines.push(`硬错误（必须修）：\n  ${r.errors.join('\n  ')}`)
      if (r.warns.length) lines.push(`警告（按 skill 交付前自查逐条修，修不完至少心里有数）：\n  ${r.warns.join('\n  ')}`)
      if (r.packed.exists) lines.push(`课件.html：已打包（${(r.packed.bytes / 1024).toFixed(0)} KB）${r.warns.some((w) => w.includes('课件.html 比页面')) ? '——已过期，重新 pack' : ''}`)
      else if (r.ok) lines.push('课件.html：还没打包（pack 一次）')
      if (!r.ok) return result(false, `机械盘点没过：${r.errors.length} 个硬错误。`, lines.join('\n'))
      const packedUpToDate = r.packed.exists && !r.warns.some((w) => w.includes('课件.html 比页面'))
      return result(true,
        `机械盘点通过（${r.warns.length} 条警告${r.warns.length ? '，warn 不阻塞但建议按 skill 自查清单修' : '，零警告'}）。` +
        `接下来：${packedUpToDate ? '直接 save 存证' : 'pack 打包再 save 存证'} → serve 启动预览，告知用户去面板预览。`,
        lines.join('\n'))
    }

    if (args.action === 'pack') {
      if (!args.dir) throw new Error('pack 需要 dir（课件工作目录）。')
      if (!existsSync(args.dir)) return result(false, `目录不存在：${args.dir}`)
      const out = packDeck(args.dir)
      if (!out.ok) return result(false, `打包失败：${out.error}`)
      return result(true,
        `已打包 ${out.pages} 页 → ${out.outFile}（${(out.bytes / 1024).toFixed(0)} KB，双击即开、断网可用）。` +
        `接下来：courseware save 存证 → serve，告知用户去侧栏「课件放映厅」预览。`)
    }

    if (args.action === 'save') {
      if (!args.dir) throw new Error('save 需要 dir（课件工作目录）。')
      if (!existsSync(args.dir)) return result(false, `目录不存在：${args.dir}`)
      const r = inspectDeck(args.dir)
      if (!r.ok || !r.deck) return result(false, `存不了：课件机械盘点没过（${r.errors.join('；')}）。先修硬错误。`)
      // 同一个课件目录再存 = 改一版：复用已有档案（否则每存一次列表里就多一条同名课件）
      const previous = (args.id && getArchive(args.id)) || findArchiveByOrigin(args.dir)
      const id = previous ? previous.id : newArchiveId()
      const destDir = archiveDirFor(id)
      const { files } = copyDeckSource(args.dir, destDir)
      const { archive: a, created } = saveArchive({
        id,
        originDir: args.dir,
        title: args.title || r.deck.title || '未命名课件',
        deckTitle: r.deck.title,
        subject: args.subject,
        grade: args.grade,
        goal: args.goal,
        pages: r.deck.pages.map((p) => p.title),
        colors: { bg: r.deck.bg, ink: r.deck.ink, accent: r.deck.accent },
        packed: r.packed.exists,
        packBytes: r.packed.bytes || 0,
        checkWarns: r.warns.length,
        sourceDir: destDir,
        files,
        note: args.note,
      })
      return result(true,
        `课件「${a.title}」已${created ? '存证' : `更新（第 ${a.revisions.length} 版）`}（id=${a.id}，${(a.pages || []).length} 页，` +
        `${a.packed ? `已打包 ${(a.packBytes / 1024).toFixed(0)} KB` : '未打包单文件（建议先 pack 再交付）'}，check 警告 ${a.checkWarns} 条）。` +
        `用户可在侧栏「课件放映厅」翻页预览；serve 启动预览服务后面板里直接播放。`)
    }

    if (args.action === 'serve') {
      const outcome = await startServer(port)
      let line = outcome.ok
        ? (outcome.alreadyRunning ? `预览服务已在跑：${outcome.url}` : `预览服务已启动：${outcome.url}`)
        : `预览服务没起来：${outcome.error}`
      const archives = listArchives()
      const target = args.id ? getArchive(args.id) : archives[0]
      if (target && outcome.ok) {
        const file = args.file || 'index.html'
        line += `\n「${target.title}」预览地址：${previewUrl(port, target.id, file)}（面板 iframe 会加载它）`
      }
      return result(outcome.ok, line, outcome.ok ? '' : outcome.error || '')
    }

    if (args.action === 'archive') {
      const archives = listArchives()
      if (!archives.length) return result(true, '还没有课件档案。save 一份即可。')
      const limit = Math.min(100, Number(args.limit) || 20)
      return result(true, `共 ${archives.length} 份课件档案：`,
        archives.slice(0, limit).map((a) => {
          const s = archiveSummary(a)
          return `- ${s.title}（${s.subject}·${s.grade}｜${s.pageCount} 页｜${s.packed ? '已打包' : '未打包'}｜${s.sample ? '示例｜' : ''}id=${s.id}）`
        }).join('\n'))
    }

    if (args.action === 'get-archive') {
      const archive = args.id ? getArchive(args.id) : null
      if (!archive) return result(false, `没有课件档案 ${args.id || ''}（先 archive 列表找 id）。`)
      const s = archiveSummary(archive)
      return result(true, `课件档案「${s.title}」（${s.subject}·${s.grade}${s.sample ? '·内置示例' : ''}）：`,
        `DECK：${s.deckTitle}\n页面（${s.pageCount}）：${s.pages.join('、') || '—'}\n配色：${s.colors ? `${s.colors.bg} / ${s.colors.ink} / ${s.colors.accent}` : '—'}\n` +
        `教学目标：${s.goal || '—'}\n打包：${s.packed ? `${(s.packBytes / 1024).toFixed(0)} KB 单文件` : '未打包'}\ncheck 警告：${s.checkWarns} 条\n` +
        `存档文件：${s.files.join(', ') || '—'}\n版本：${s.revisions} 版\n预览：${previewUrl(port, s.id)}`)
    }

    if (args.action === 'history') {
      const events = listArchiveHistory({ kind: args.kind || 'all', q: args.note || args.q, limit: Math.min(100, Number(args.limit) || 20) })
      if (!events.length) return result(true, '还没有历史记录', 'save / delete 之后这里会留记录。')
      return result(true, `最近 ${events.length} 条课件历史：`,
        events.map((e) => `- ${String(e.at).slice(0, 16).replace('T', ' ')} ${KIND_LABEL[e.kind] || e.kind}｜${e.title}｜${e.summary}｜event=${e.id}`).join('\n'))
    }

    if (args.action === 'restore') {
      const event = args.eventId ? listArchiveHistory({ limit: 300 }).find((e) => e.id === args.eventId) : null
      const target = event && event.kind === 'delete' ? restoreFromHistory(args.eventId) : null
      if (!target) {
        const hint = event ? '这条历史不是删除记录（只有删除才有快照可恢复）。' : '要传 eventId（history 里能看到，形如 ev-xxx）。'
        return result(false, '没有可恢复的快照', hint)
      }
      return result(true, `已恢复课件档案「${target.title}」（id=${target.id}）`, `页面：${(target.pages || []).join('、') || '—'}`)
    }

    // delete
    if (!args.id) throw new Error('delete 需要 id（先 archive 找到）。')
    if (args.confirm !== 'yes') return result(false, '删除课件档案请用 confirm:"yes"。')
    const removed = deleteArchive(args.id)
    return removed
      ? result(true, `课件档案「${removed.title}」已删除（生成历史里留了快照，可用 restore 恢复；你工作区里的课件源文件不受影响）。`)
      : result(false, `没有课件档案 ${args.id}。`)
  },
}

export function apply(ctx, config) {
  configRef.config = { ...(config ?? {}), _version: PLUGIN_VERSION }
  const skillDirs = [join(PLUGIN_ROOT, '..', 'skills')]
  const examplesDir = join(PLUGIN_ROOT, '..', 'skills', 'interactive-courseware', 'examples')

  ctx.effect(() => ctx.tools.register(coursewareTool), `${name}: tool courseware`)
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  // 插件重载 / 禁用时把预览端口还回去，否则旧监听会一直占着 5100（新实例再起来就抢不到）
  ctx.effect(() => () => { stopServer().catch(() => {}) }, `${name}: preview server`)
  configRef.seedPromise = seedSamples(examplesDir).catch(() => {})
  ctx.effect(() => registerApi(ctx, { configRef }), `${name}: routes`)
}
