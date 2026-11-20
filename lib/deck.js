// 课件放映厅 · DECK 解析 + 页面机械红线盘点。
// 职责边界（创作归 agent，程序只拦机械事故 + 格式约定，warn 不阻塞）：
//   - 硬错误：index.html 缺失 / DECK 解析失败 / DECK.pages 引用的页面文件不存在（pack 必挂）
//   - warn：title 格式、三段公共一致性、色值直写、外链图片、Emoji、hidden 规则、
//           播放器外壳被改、课件.html 过期……（agent 按 skill 交付前自查逐条修）
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 三段固定代码的原文（skill 快照内），只复制不改的纪律基准
export const PLAYER_ASSET = fileURLToPath(new URL('../skills/interactive-courseware/assets/player.html', import.meta.url))
export const TEMPLATE_ASSET = fileURLToPath(new URL('../skills/interactive-courseware/assets/page-template.html', import.meta.url))

const PAGE_FILE_RE = /^page-\d+\.html$/

// ---------------------------------------------------------------- DECK 解析

// 定位 const DECK = {...} 字面量的 [start, end) 区间（括号配对，跳过字符串字面量）。
function deckBlockSpan(html) {
  const m = String(html).match(/const\s+DECK\s*=/)
  if (!m) return null
  const start = m.index + m[0].length
  let depth = 0
  let end = -1
  let inStr = null
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) { end = i + 1; break }
    }
  }
  return end === -1 ? null : [start, end]
}

// 从播放器源码里抠出 const DECK = {...} 并求值（内容是本插件工作流自己的产物，可信）。
export function parseDeck(html) {
  const span = deckBlockSpan(html)
  if (!span) return null
  try {
    const deck = new Function(`return (${html.slice(span[0], span[1])})`)()
    if (!deck || !Array.isArray(deck.pages) || !deck.pages.length) return null
    return deck
  } catch {
    return null
  }
}

export function deckSummary(deck) {
  return {
    title: String(deck.title || ''),
    bg: deck.bg, ink: deck.ink, accent: deck.accent,
    pageCount: deck.pages.length,
    pages: deck.pages.map((p) => ({ title: String(p.title || ''), src: String(p.src || '') })),
  }
}

// ---------------------------------------------------------------- 页面盘点

const stripBlock = (html, re) => String(html).replace(re, '')

// 抠出骨架的三大公共段（每页必须一字不差）：配色段 / 骨架和部件段 / 公共脚本段
function commonSections(html) {
  const text = String(html)
  const color = text.match(/\/\* =+ 一、配色[\s\S]*?(?=\n\/\* =+ 二、骨架)/)
  const shell = text.match(/\/\* =+ 二、骨架和部件[\s\S]*?(?=\n\/\* =+ 三、本页样式)/)
  const script = text.match(/\/\* =+ 公共脚本：每一页完全一样[\s\S]*?(?=\n\<\/script>)/)
  return {
    color: color ? color[0].trim() : null,
    shell: shell ? shell[0].trim() : null,
    script: script ? script[0].trim() : null,
  }
}

const SECTION_LABEL = { color: '配色段', shell: '骨架段', script: '公共脚本段' }

// 单页机械检查。ref 是第 1 页（三段公共基准）；没有 ref 时只查自身格式。
export function inspectPage(dir, src, index, deck, ref) {
  const warns = []
  const add = (msg) => warns.push(`page-${String(index + 1).padStart(2, '0')} ${src}：${msg}`)
  const file = join(dir, src)
  // 归一化 CRLF：Windows 编辑器保存的页面（CRLF）与骨架（LF）三段必须仍能逐字比对
  const html = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

  // 1) <title> 格式：课程名 · NN · 本页标题（公共脚本靠课程名记星星，课程名不一致会散档）
  const t = html.match(/<title>([^<]*)<\/title>/)?.[1] || ''
  const parts = t.split('·').map((s) => s.trim())
  if (parts.length !== 3) add(`<title> 不是「课程名 · ${String(index + 1).padStart(2, '0')} · 本页标题」三段格式：${t}`)
  else {
    if (parts[0] !== String(deck.title || '').trim()) add(`<title> 课程名「${parts[0]}」与 DECK.title「${deck.title}」不一致（星星会记到不同 key）`)
    if (parts[1] !== String(index + 1).padStart(2, '0')) add(`<title> 页码「${parts[1]}」与文件序号 ${String(index + 1).padStart(2, '0')} 不一致`)
  }

  // 2) 三段公共一致性（对照第 1 页）
  if (ref) {
    const mine = commonSections(html)
    const base = commonSections(ref.html)
    for (const key of ['color', 'shell', 'script']) {
      if (!base[key] || !mine[key]) {
        if (!mine[key]) add(`缺「${SECTION_LABEL[key]}」公共段（骨架可能没从 page-template.html 复制）`)
        continue
      }
      if (mine[key] !== base[key]) add(`「${SECTION_LABEL[key]}」与第 1 页不一致（公共段每页必须一字不差）`)
    }
  }

  // 3) 色值直写：本页样式与 SVG 只许 var(--…)，不允许 #hex / rgb()（配色段的定义除外）
  const body = stripBlock(html, /\/\* =+ 一、配色[\s\S]*?\n\}\n/)
  const colorHits = body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || []
  const colorLines = [...new Set(
    body.split(/\r?\n/).filter((l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)).map((l) => l.trim().slice(0, 120)),
  )]
  if (colorHits.length) add(`本页样式/SVG 里直接写了色值（${colorHits.length} 处），应只用 var(--…)：${colorLines.slice(0, 3).join(' ⏎ ')}`)

  // 4) 外链图片（skill 硬规则 8：不用外链图片；importmap 的 three CDN 不算）
  const noMaps = stripBlock(html, /<script[^>]*importmap[^>]*>[\s\S]*?<\/script>/g)
  const extImg = noMaps.match(/<(img|source|video|audio)[^>]+src\s*=\s*["']https?:[^"']+|url\(\s*["']?https?:[^)]+\)/g) || []
  if (extImg.length) add(`用了外链图片/媒体（${extImg.length} 处），断网就开天窗：${extImg[0].slice(0, 100)}`)

  // 5) Emoji（skill 硬规则 8：图标用内联 SVG；✓✔✗✘ 是 skill 规定的对错反馈用字，不算）
  const emoji = html.replace(/[✓✔✗✘]/g, '').match(/\p{Extended_Pictographic}/gu) || []
  if (emoji.length) add(`页面里有 Emoji（${emoji.slice(0, 5).join(' ')}…），图标和插图应改用内联 SVG`)

  // 6) hidden 规则：用了 hidden 属性但本页样式没兜底（.btn 自带 display 会盖过 hidden）
  const usesHidden = /\shidden[\s>]/.test(html)
  const hasGuard = /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/.test(html)
  if (usesHidden && !hasGuard) add('用了 hidden 属性但本页样式缺 `[hidden] { display: none !important; }` 兜底，该藏的按钮会提前露出来')

  // 7) 播放器部件混入（skill 硬规则 1：页面只放内容）——只拦真按钮/JS 赋值，
  //    放过教学文案里的自然引用（如「上一页的石块」「下一页你要亲手做一遍」）
  const chrome = html.match(/>(\s*)(上一页|下一页)(\s*)<|textContent\s*=\s*['"](上一页|下一页)['"]/) || []
  if (chrome.length) add('页面里出现了「上一页/下一页」按钮——翻页由播放器提供，页面不要再画自己的翻页按钮')

  return { src, file, bytes: statSync(file).size, warns, html }
}

// ---------------------------------------------------------------- 整体盘点

// index.html 是否 = player.html 原文只改 DECK：把 DECK 块挖掉后逐字比较（先归一化行尾）。
export function shellIsPristine(indexHtml, playerHtml) {
  const strip = (s) => {
    const t = String(s).replace(/\r\n/g, '\n')
    const span = deckBlockSpan(t)
    if (!span) return t
    return t.slice(0, span[0]) + t.slice(span[1]).replace(/^\s*;?/, '')
  }
  return strip(indexHtml) === strip(playerHtml)
}

export function readPackedInfo(dir) {
  const file = join(dir, '课件.html')
  if (!existsSync(file)) return { exists: false }
  return { exists: true, bytes: statSync(file).size, mtime: statSync(file).mtimeMs }
}

// 完整盘点一个课件目录。返回
// { ok, errors[], warns[], deck, pages[], packed, shellPristine, dir }
export function inspectDeck(dir, { playerHtml } = {}) {
  const errors = []
  const warns = []
  const indexFile = join(dir, 'index.html')
  if (!existsSync(indexFile)) {
    return { ok: false, errors: [`目录里没有 index.html（播放器）：${dir}`], warns, deck: null, pages: [], packed: readPackedInfo(dir), dir }
  }
  const indexHtml = readFileSync(indexFile, 'utf8')
  const deck = parseDeck(indexHtml)
  if (!deck) errors.push('index.html 里解析不出 DECK（必须是 player.html 原文，只改 const DECK = {...}）')

  let pages = []
  if (deck) {
    const ref = { src: null, html: null }
    deck.pages.forEach((p, i) => {
      const src = String(p.src || '')
      const file = join(dir, src)
      if (!existsSync(file)) {
        errors.push(`DECK.pages[${i}] 引用的 ${src} 不存在（pack 也会挂）`)
        return
      }
      if (!PAGE_FILE_RE.test(src)) warns.push(`${src}：页面文件名不是 page-XX.html 约定格式`)
      const inspected = inspectPage(dir, src, i, deck, ref.src ? ref : null)
      if (!ref.src) { ref.src = src; ref.html = inspected.html } // 第 1 页做三段公共基准
      pages.push(inspected)
    })
    pages.forEach((p) => warns.push(...p.warns))

    // 外壳纪律：index.html 必须是 player.html 原文，只改 DECK
    const player = playerHtml ?? readFileSync(PLAYER_ASSET, 'utf8')
    if (!shellIsPristine(indexHtml, player)) warns.push('index.html 不是 player.html 原文（或播放器逻辑被改动过）——外壳只许改 DECK')

    // 页面标题清单（存证用）
  }
  const packed = readPackedInfo(dir)
  // 课件.html 新鲜度：页面/播放器比它新 → 提醒重新打包
  if (packed.exists && deck) {
    const newestPage = Math.max(statSync(indexFile).mtimeMs, ...pages.map((p) => statSync(p.file).mtimeMs))
    if (newestPage > packed.mtime) warns.push('课件.html 比页面/播放器旧——改过页面后记得重新 pack')
  }
  return {
    ok: errors.length === 0,
    errors, warns, deck: deck ? deckSummary(deck) : null, pages,
    packed, dir,
  }
}

// 存证用：从 DECK 拿页面短标题清单
export function pageTitles(deck) {
  return (deck?.pages || []).map((p) => String(p.title || '').trim()).filter(Boolean)
}
