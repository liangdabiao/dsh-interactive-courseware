// 课件放映厅 · lib 层单测（沙盒：临时目录搭迷你课件 + 独立 DSH_HOME）。
// 运行：node test/lib.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SANDBOX = mkdtempSync(join(tmpdir(), 'dsh-icw-test-'))
process.env.DSH_HOME = join(SANDBOX, 'dsh-home') // 必须在 import archive.js 之前设好

const {
  PLAYER_ASSET, TEMPLATE_ASSET, parseDeck, deckSummary, shellIsPristine, inspectDeck, pageTitles,
} = await import('../lib/deck.js')
const { packDeck, packedSelfContained } = await import('../lib/pack.js')
const { scaffoldDeck, TEMPLATE_ASSET: T2 } = await import('../lib/scaffold.js')
const {
  DATA_DIR, DECKS_DIR, KIND_LABEL, SUBJECTS, newArchiveId, saveArchive, listArchives,
  getArchive, deleteArchive, restoreFromHistory, listArchiveHistory, clearHistory,
  stats, archiveSummary, archiveDirFor, copyDeckSource, readArchivedFile, seedSamples,
} = await import('../lib/archive.js')
const { previewUrl, serverHealth, startServer, stopServer, previewBase } =
  await import('../lib/serve.js')

test.after?.(() => rmSync(SANDBOX, { recursive: true, force: true }))

// ---------------------------------------------------------------- 迷你课件夹具

const DECK = {
  title: '测试课件', bg: '#F6F1E7', ink: '#1F1B16', accent: '#C4411A',
  pages: [
    { title: '封面', src: 'page-01.html' },
    { title: '实验台', src: 'page-02.html' },
  ],
}

function makePage(titleLine, { colorNote = '', pageStyle = '', pageScript = '', body = '<main></main>' } = {}) {
  const tpl = readFileSync(TEMPLATE_ASSET, 'utf8')
  let html = tpl.replace(/<title>[^<]*<\/title>/, `<title>${titleLine}</title>`)
  if (colorNote) html = html.replace('--accent-ink: #1A1400;', `--accent-ink: #1A1400; ${colorNote}`)
  if (pageStyle) html = html.replace('[hidden] { display: none !important; }', `[hidden] { display: none !important; }\n${pageStyle}`)
  if (body) html = html.replace('<main>\n  </main>', body)
  if (pageScript) html = html.replace('/* ========== 本页脚本：内容数据写在最上面，逻辑写在下面 ========== */', `/* ========== 本页脚本：内容数据写在最上面，逻辑写在下面 ========== */\n${pageScript}`)
  return html
}

function makeIndex(playerHtml, deck) {
  // 按人手改播放器的方式排版 DECK（保持 player 原文风格：src: "page-XX.html"）
  const lines = [
    'const DECK = {',
    `  title: ${JSON.stringify(deck.title)},`,
    `  bg: ${JSON.stringify(deck.bg)},`,
    `  ink: ${JSON.stringify(deck.ink)},`,
    `  accent: ${JSON.stringify(deck.accent)},`,
    '  pages: [',
    ...deck.pages.map((p) => `    { title: ${JSON.stringify(p.title)}, src: ${JSON.stringify(p.src)} },`),
    '  ]',
    '};',
  ]
  return playerHtml.replace(/const DECK = \{[\s\S]*?\n\};/, lines.join('\n'))
}

const DECK_DIR = join(SANDBOX, 'mini-deck')
function seedDeck(dir = DECK_DIR) {
  mkdirSync(dir, { recursive: true })
  const player = readFileSync(PLAYER_ASSET, 'utf8')
  writeFileSync(join(dir, 'index.html'), makeIndex(player, DECK), 'utf8')
  writeFileSync(join(dir, 'page-01.html'), makePage('测试课件 · 01 · 封面'), 'utf8')
  writeFileSync(join(dir, 'page-02.html'), makePage('测试课件 · 02 · 实验台'), 'utf8')
}

// ---------------------------------------------------------------- deck.js · DECK 解析

test('parseDeck：从播放器原文抠出 DECK 并求值', () => {
  const player = readFileSync(PLAYER_ASSET, 'utf8')
  const deck = parseDeck(player)
  assert.ok(deck, '原版播放器应能解析')
  assert.equal(deck.title, '课程标题')
  assert.equal(deck.pages.length, 2)
  const mine = parseDeck(makeIndex(player, DECK))
  assert.equal(mine.title, '测试课件')
  assert.deepEqual(deckSummary(mine).pages.map((p) => p.src), ['page-01.html', 'page-02.html'])
})

test('parseDeck：坏输入返回 null（缺 DECK / 缺 pages / 烂 JS）', () => {
  assert.equal(parseDeck('<html>nothing</html>'), null)
  assert.equal(parseDeck('const DECK = { title: "x" };'), null, '没有 pages 数组')
  assert.equal(parseDeck('const DECK = { pages: [1] '), null, '括号不闭合')
})

test('shellIsPristine：原文只改 DECK → true；动了播放器逻辑 → false', () => {
  const player = readFileSync(PLAYER_ASSET, 'utf8')
  const index = makeIndex(player, DECK)
  assert.equal(shellIsPristine(index, player), true, '只改 DECK 应判定原样')
  const tampered = index.replace("addEventListener('hashchange'", "window.addEventListener('hashchange'")
  assert.equal(shellIsPristine(tampered, player), false, '改了播放器逻辑应判 false')
})

// ---------------------------------------------------------------- deck.js · 机械盘点

test('inspectDeck：干净迷你课件零 error 零 warn', () => {
  seedDeck()
  const r = inspectDeck(DECK_DIR)
  assert.equal(r.ok, true, `应通过：${r.errors.join('；')}`)
  assert.deepEqual(r.warns, [], `应零警告：${r.warns.join(' | ')}`)
  assert.equal(r.deck.pageCount, 2)
  assert.deepEqual(pageTitles(r.deck), ['封面', '实验台'])
  assert.equal(r.packed.exists, false)
})

test('inspectDeck：缺 index.html / 缺页面文件是硬错误', () => {
  const r = inspectDeck(join(SANDBOX, 'no-dir'))
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /index\.html/)
  const dir2 = join(SANDBOX, 'missing-page')
  seedDeck(dir2)
  rmSync(join(dir2, 'page-02.html'))
  const r2 = inspectDeck(dir2)
  assert.equal(r2.ok, false)
  assert.match(r2.errors.join(''), /page-02\.html 不存在/)
})

test('inspectDeck：title 格式/课程名/页码不一致都点名', () => {
  const dir = join(SANDBOX, 'bad-titles')
  mkdirSync(dir, { recursive: true })
  const player = readFileSync(PLAYER_ASSET, 'utf8')
  writeFileSync(join(dir, 'index.html'), makeIndex(player, DECK), 'utf8')
  writeFileSync(join(dir, 'page-01.html'), makePage('测试课件 · 01 · 封面'), 'utf8')
  writeFileSync(join(dir, 'page-02.html'), makePage('别的课件 · 3 · 实验台'), 'utf8') // 课程名错 + 页码错 + 非两位
  const r = inspectDeck(dir)
  assert.equal(r.ok, true, 'title 问题只是 warn')
  const text = r.warns.join('\n')
  assert.match(text, /课程名「别的课件」/)
  assert.match(text, /页码「3」/)
})

test('inspectDeck：三段公共段被改动会点名（配色段不一致）', () => {
  const dir = join(SANDBOX, 'bad-common')
  seedDeck(dir)
  const tpl = readFileSync(join(dir, 'page-02.html'), 'utf8')
  // 动配色段（每页必须照抄第 1 页）
  writeFileSync(join(dir, 'page-02.html'), tpl.replace('--accent: #FFD23F;', '--accent: #FF0000;'), 'utf8')
  const r = inspectDeck(dir)
  assert.match(r.warns.join('\n'), /配色段」与第 1 页不一致/)
})

test('inspectDeck：本页样式直写色值被点名（配色段定义除外）', () => {
  const dir = join(SANDBOX, 'bad-colors')
  seedDeck(dir)
  const tpl = readFileSync(join(dir, 'page-02.html'), 'utf8')
  writeFileSync(join(dir, 'page-02.html'),
    tpl.replace('[hidden] { display: none !important; }', '[hidden] { display: none !important; }\n.badge { color: #e74c3c; border-color: rgba(0,0,0,.4); }'), 'utf8')
  const r = inspectDeck(dir)
  assert.match(r.warns.join('\n'), /直接写了色值（2 处）/)
})

test('inspectDeck：外链图片 / Emoji / 播放器部件混入 各自点名', () => {
  const dir = join(SANDBOX, 'bad-misc')
  mkdirSync(dir, { recursive: true })
  const player = readFileSync(PLAYER_ASSET, 'utf8')
  writeFileSync(join(dir, 'index.html'), makeIndex(player, DECK), 'utf8')
  writeFileSync(join(dir, 'page-01.html'), makePage('测试课件 · 01 · 封面'), 'utf8')
  writeFileSync(join(dir, 'page-02.html'),
    makePage('测试课件 · 02 · 实验台', {
      body: '<main><img src="https://cdn.example.com/a.png" alt=""><button hidden class="btn">下一关</button><span>😀</span><b class="note">上一页</b></main>',
    }), 'utf8')
  const r = inspectDeck(dir)
  const text = r.warns.join('\n')
  assert.match(text, /外链图片/)
  assert.match(text, /Emoji（😀/)
  assert.match(text, /「上一页\/下一页」/)
  assert.ok(!/hidden 属性/.test(text), '模板自带兜底，不应误报')
})

test('inspectDeck：hidden 兜底被删掉时点名', () => {
  const dir = join(SANDBOX, 'bad-hidden')
  mkdirSync(dir, { recursive: true })
  const player = readFileSync(PLAYER_ASSET, 'utf8')
  writeFileSync(join(dir, 'index.html'), makeIndex(player, DECK), 'utf8')
  writeFileSync(join(dir, 'page-01.html'), makePage('测试课件 · 01 · 封面'), 'utf8')
  const page = makePage('测试课件 · 02 · 实验台', { body: '<main><button hidden class="btn">宣判</button></main>' })
  writeFileSync(join(dir, 'page-02.html'), page.replace('[hidden] { display: none !important; }', '.x { color: var(--ink); }'), 'utf8')
  const r = inspectDeck(dir)
  assert.match(r.warns.join('\n'), /hidden 属性但本页样式缺/)
})

test('inspectDeck：CRLF 行尾的页面不该误报三段不一致/色值直写', () => {
  const dir = join(SANDBOX, 'crlf-deck')
  seedDeck(dir)
  // 模拟 Windows 编辑器保存成 CRLF（内容与 LF 版完全一致）
  for (const name of ['page-02.html', 'index.html']) {
    const file = join(dir, name)
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\n/g, '\r\n'), 'utf8')
  }
  const r = inspectDeck(dir)
  const text = r.warns.join('\n')
  assert.equal(r.ok, true)
  assert.ok(!/不一致/.test(text), `CRLF 不该引发三段不一致：${text}`)
  assert.ok(!/色值/.test(text), `CRLF 不该引发配色段剥离失败：${text}`)
  assert.ok(!/player\.html 原文/.test(text), `CRLF 不该引发外壳误报：${text}`)
})

test('inspectDeck：课件.html 过期提醒（页面比它新）', () => {
  const dir = join(SANDBOX, 'stale-pack')
  seedDeck(dir)
  // 把 课件.html 的 mtime 明确拨到过去（Windows 毫秒级 mtime 可能打平）
  const packedFile = join(dir, '课件.html')
  writeFileSync(packedFile, 'old', 'utf8')
  const past = new Date(Date.now() - 60_000)
  utimesSync(packedFile, past, past)
  const r = inspectDeck(dir)
  assert.match(r.warns.join('\n'), /课件\.html 比页面.*旧/)
})

test('inspectDeck：importmap 的 three CDN 不算外链图片', () => {
  const dir = join(SANDBOX, 'three-page')
  seedDeck(dir)
  const tpl = readFileSync(join(dir, 'page-02.html'), 'utf8')
  // 往 head 里插 importmap（3D 页的标准加载方式）
  const withMap = tpl.replace('</head>',
    `<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js" } }<` + `/script></head>`)
  writeFileSync(join(dir, 'page-02.html'), withMap, 'utf8')
  const r = inspectDeck(dir)
  assert.ok(!/外链图片/.test(r.warns.join('\n')), `importmap 不该报外链：${r.warns.join(' | ')}`)
})

// ---------------------------------------------------------------- pack.js

test('packDeck：全部页面内嵌成单文件，产物自包含', () => {
  const dir = join(SANDBOX, 'pack-deck')
  seedDeck(dir)
  const out = packDeck(dir)
  assert.equal(out.ok, true, out.error || '')
  assert.equal(out.pages, 2)
  const packed = readFileSync(out.outFile, 'utf8')
  assert.ok(packed.includes('const DECK'), '保留播放器外壳')
  assert.ok(packed.includes('测试课件 · 01 · 封面'), '第 1 页全文已进 DECK')
  assert.ok(packed.includes('测试课件 · 02 · 实验台'), '第 2 页全文已进 DECK')
  assert.equal(packedSelfContained(packed), true, '不应残留 src: "page-XX.html" 引用')
  // 页面正文在 DECK 字面量里，其中的 < 必须全部转义成 \u003c（否则会截断播放器脚本）
  const fromDeck = packed.slice(packed.indexOf('const DECK'))
  assert.ok(fromDeck.includes('\\u003c'), '页面里的 < 已转义为 \\u003c')
})

test('packDeck：缺页面 / 缺 DECK 报错不写文件', () => {
  const dir = join(SANDBOX, 'pack-bad')
  seedDeck(dir)
  rmSync(join(dir, 'page-01.html'))
  const r1 = packDeck(dir)
  assert.equal(r1.ok, false)
  assert.match(r1.error, /找不到页面文件/)
  const dir2 = join(SANDBOX, 'pack-nodeck')
  mkdirSync(dir2, { recursive: true })
  writeFileSync(join(dir2, 'index.html'), '<html>no deck</html>', 'utf8')
  const r2 = packDeck(dir2)
  assert.equal(r2.ok, false)
  assert.match(r2.error, /解析不出 DECK/)
})

test('packDeck：页面正文里的 </script> 不会截断播放器（转义验证）', () => {
  const dir = join(SANDBOX, 'pack-script')
  seedDeck(dir)
  const tpl = readFileSync(join(dir, 'page-02.html'), 'utf8')
  writeFileSync(join(dir, 'page-02.html'),
    tpl.replace('/* ========== 本页脚本：内容数据写在最上面，逻辑写在下面 ========== */',
      '/* ========== 本页脚本 ========== */\nvar s = "</scr" + "ipt>";'), 'utf8')
  const out = packDeck(dir)
  assert.equal(out.ok, true, out.error || '')
  const packed = readFileSync(out.outFile, 'utf8')
  // 页面里的 < 全部转义成 \u003c，播放器自己的 </script> 是唯一的真结束标签
  assert.ok(packed.includes('\\u003c/scr'), '页面正文里的 </script 已转义')
  assert.equal(packed.split('</script>').length, 2, '真结束标签只剩播放器自己那一个')
})

// ---------------------------------------------------------------- scaffold.js

test('scaffold：空目录落三段固定代码；再跑不覆盖', () => {
  const dir = join(SANDBOX, 'scaffold-deck')
  const out1 = scaffoldDeck(dir)
  assert.deepEqual(out1.written.sort(), ['pack.py', 'page-template.html', 'player.html'])
  assert.ok(existsSync(join(dir, 'page-template.html')))
  writeFileSync(join(dir, 'page-template.html'), '改动过', 'utf8')
  const out2 = scaffoldDeck(dir)
  assert.deepEqual(out2.written, [])
  assert.equal(readFileSync(join(dir, 'page-template.html'), 'utf8'), '改动过', '已存在不覆盖')
  assert.ok(T2 && existsSync(T2))
})

// ---------------------------------------------------------------- archive.js

test('data 目录落在 DSH_HOME 沙盒下', () => {
  assert.ok(DATA_DIR.startsWith(process.env.DSH_HOME))
  assert.ok(DECKS_DIR.startsWith(DATA_DIR))
})

test('newArchiveId：deck-<日期>-<随机> 格式且不重复', () => {
  const a = newArchiveId()
  const b = newArchiveId()
  assert.match(a, /^deck-\d{8}-[a-z0-9]{4}$/)
  assert.notEqual(a, b)
})

test('copyDeckSource：只搬交付物（index/page-*/课件.html），脚手架不进档案', () => {
  const dir = join(SANDBOX, 'copy-src')
  seedDeck(dir)
  writeFileSync(join(dir, '课件.html'), 'packed', 'utf8')
  writeFileSync(join(dir, 'page-template.html'), 'tpl', 'utf8')
  writeFileSync(join(dir, 'pack.py'), 'py', 'utf8')
  const dest = join(SANDBOX, 'copy-dest')
  const { files, pages } = copyDeckSource(dir, dest)
  assert.ok(files.includes('index.html') && files.includes('课件.html'))
  assert.equal(pages, 2)
  assert.ok(!files.includes('page-template.html'), '脚手架不归档')
  assert.ok(existsSync(join(dest, 'page-02.html')))
})

test('readArchivedFile：白名单 *.html 放行，穿越/其他后缀拒绝', () => {
  const dir = join(SANDBOX, 'copy-dest')
  assert.ok(readArchivedFile(dir, 'index.html').includes('const DECK'))
  assert.ok(readArchivedFile(dir, '课件.html') === 'packed')
  assert.equal(readArchivedFile(dir, 'pack.py'), null)
  assert.equal(readArchivedFile(dir, '../escape.html'), null)
  assert.equal(readArchivedFile(dir, 'no-such.html'), null)
})

test('saveArchive：新建（缺省归一）/ archiveSummary 完整', () => {
  const { archive, created } = saveArchive({
    title: '测试课件', deckTitle: '测试课件', subject: '物理', grade: '初中',
    goal: '排水法测体积', pages: ['封面', '实验台'], colors: { bg: '#F6F1E7', ink: '#1F1B16', accent: '#C4411A' },
    packed: true, packBytes: 2048, checkWarns: 0, sourceDir: join(SANDBOX, 'copy-dest'),
    files: ['index.html', 'page-01.html', 'page-02.html', '课件.html'], note: '首版',
  })
  assert.equal(created, true)
  assert.match(archive.id, /^deck-/)
  const s = archiveSummary(archive)
  assert.equal(s.pageCount, 2)
  assert.equal(s.packed, true)
  assert.equal(s.colors.accent, '#C4411A')
  assert.equal(listArchives().length, 1)
})

test('saveArchive：非法学科/学段回落，页数组/串都能归一', () => {
  const { archive } = saveArchive({ title: 'X 课件', subject: '魔法', grade: '博士', pages: 'a, b, c' })
  assert.equal(archive.subject, '其他')
  assert.equal(archive.grade, '通识')
  assert.deepEqual(archive.pages, ['a', 'b', 'c'])
})

test('saveArchive：title 缺失抛错；同 id 覆盖多一版 revision + update 历史', () => {
  assert.throws(() => saveArchive({}), /标题/)
  const first = listArchives()[0]
  const { archive, created } = saveArchive({
    id: first.id, title: '测试课件（修订）', pages: first.pages, note: '修了实验台',
  })
  assert.equal(created, false)
  assert.equal(archive.revisions.length, 1)
  assert.ok(listArchiveHistory({ kind: 'update' }).some((e) => e.summary === '修了实验台'))
})

test('deleteArchive 留快照 + restore 恢复 + 重复恢复不重插', () => {
  const victim = saveArchive({ title: '待删课件', pages: ['p'] }).archive
  const removed = deleteArchive(victim.id)
  assert.ok(removed)
  assert.equal(getArchive(victim.id), null)
  const ev = listArchiveHistory({ kind: 'delete' }).find((e) => e.archiveId === victim.id)
  assert.ok(ev?.snapshot)
  const restored = restoreFromHistory(ev.id)
  assert.equal(restored.id, victim.id)
  restoreFromHistory(ev.id)
  assert.equal(listArchives().filter((a) => a.id === victim.id).length, 1)
  assert.equal(restoreFromHistory('ev-nope'), null)
})

test('listArchiveHistory：kind/q/limit 过滤；stats 一致；clearHistory 清事件留档案', () => {
  assert.ok(listArchiveHistory({ q: '测试' }).length >= 1)
  assert.equal(listArchiveHistory({ limit: 2 }).length, 2)
  const s = stats()
  assert.equal(s.archives, listArchives().length)
  assert.equal(s.pages, listArchives().reduce((n, a) => n + (a.pages || []).length, 0))
  assert.equal(s.packed, listArchives().filter((a) => a.packed).length)
  const eventsBefore = listArchiveHistory({ limit: 300 }).length
  clearHistory()
  assert.equal(stats().events, 0)
  assert.equal(stats().archives, s.archives)
  assert.ok(eventsBefore > 0)
})

test('KIND_LABEL / SUBJECTS 常量齐全；archiveDirFor 落位', () => {
  assert.deepEqual(Object.keys(KIND_LABEL), ['create', 'update', 'delete', 'restore'])
  assert.ok(SUBJECTS.includes('语文') && SUBJECTS.includes('数学'))
  assert.ok(archiveDirFor('deck-20260101-abcd').includes(join('decks', 'deck-20260101-abcd')))
})

test('seedSamples：首次种入内置示例（sample 标），重跑不复活', async () => {
  const examples = join(SANDBOX, 'seed-examples')
  // 造一个假示例目录，名字用 seedSamples 认的内置名（真示例在插件目录，单测里用迷你课件顶上）
  const ex = join(examples, 'archimedes-buoyancy')
  seedDeck(ex)
  const packed = packDeck(ex)
  assert.equal(packed.ok, true, packed.error || '')
  const created = await seedSamples(examples)
  assert.equal(created.length, 1, 'pythagoras 目录缺席应跳过')
  const sample = archiveSummary(listArchives().find((a) => a.sample))
  assert.ok(sample, '示例带 sample 标')
  assert.equal(sample.title, '阿基米德与浮力')
  assert.equal(sample.packed, true, '示例被打包')
  assert.equal(sample.pageCount, 2)
  const again = await seedSamples(examples)
  assert.equal(again.length, 0, '种子标记生效，不复活')
})

// ---------------------------------------------------------------- serve.js

test('serverHealth：没人监听的端口返回 up:false（不抛错）', async () => {
  const out = await serverHealth(59999)
  assert.equal(out.up, false)
})

test('previewUrl：档案/文件两段式', () => {
  assert.equal(previewUrl(5100, 'deck-1', 'index.html'), 'http://127.0.0.1:5100/deck-1/index.html')
  assert.equal(previewUrl(5100, 'deck-1', '课件.html'), 'http://127.0.0.1:5100/deck-1/' + encodeURIComponent('课件.html'))
  assert.equal(previewBase(5100), 'http://127.0.0.1:5100')
})

test('startServer：起来 → 真实可达 → 再启动幂等 → 停止后探测不通', async () => {
  const port = 5177
  const up1 = await startServer(port)
  assert.equal(up1.ok, true, up1.error || '')
  const health = await serverHealth(port)
  assert.equal(health.up, true)
  const again = await startServer(port)
  assert.equal(again.ok, true)
  assert.equal(again.alreadyRunning, true)
  // 真实拉一次课件
  const list = listArchives()
  const some = list[0]
  const res = await fetch(previewUrl(port, some.id, 'index.html'))
  assert.equal(res.ok, true)
  const html = await res.text()
  assert.ok(html.includes('const DECK'), 'serve 出来的是完整播放器')
  await stopServer()
  const health2 = await serverHealth(port)
  assert.equal(health2.up, false)
})

test('startServer：端口被别人占用时如实报错不抢', async () => {
  const http = await import('node:http')
  const port = 5179
  const squatter = http.createServer(() => {}).listen(port, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 120))
  const out = await startServer(port)
  assert.equal(out.ok, false)
  assert.match(out.error, /占用/)
  squatter.close()
  await stopServer()
})

test('startServer：端口上已是本插件的服务（旧实例/多窗口）时认领，不报占用', async () => {
  const http = await import('node:http')
  const port = 5178
  const first = listArchives()[0]
  assert.ok(first, '需要档案库里至少有一份课件')
  const size = statSync(join(DECKS_DIR, first.id, 'index.html')).size
  // 模拟「另一个本插件实例」：只对这份课件的 index.html 回 HEAD + 对得上的 content-length
  const twin = http.createServer((req, res) => {
    if (req.method === 'HEAD' && req.url === `/${first.id}/index.html`) {
      res.writeHead(200, { 'content-length': size })
      return res.end()
    }
    res.writeHead(404)
    res.end('not found')
  }).listen(port, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 120))
  const out = await startServer(port)
  assert.equal(out.ok, true)
  assert.equal(out.alreadyRunning, true)
  assert.equal(out.adopted, true)
  twin.close()
  await stopServer()
})

test('startServer：端口上是别人的 200（不是我们的档案）仍如实报占用', async () => {
  const http = await import('node:http')
  const port = 5177
  // 什么路径都回 200 但 content-length 对不上课件指纹 —— 不能认领
  const stranger = http.createServer((req, res) => {
    res.writeHead(200, { 'content-length': 7, 'content-type': 'text/html; charset=utf-8' })
    res.end(req.method === 'HEAD' ? undefined : 'hello!!')
  }).listen(port, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 120))
  const out = await startServer(port)
  assert.equal(out.ok, false)
  assert.match(out.error, /占用/)
  stranger.close()
  await stopServer()
})

// ---------------------------------------------------------------- 冒烟：数据文件落盘

test('存证 JSON 真实落盘（archives.json 可读回）', () => {
  const raw = JSON.parse(readFileSync(join(DATA_DIR, 'archives.json'), 'utf8'))
  assert.ok(Array.isArray(raw) && raw.length >= 3)
})

// ---------------------------------------------------------------- 生命周期：插件禁用/重载要还端口

test('apply 注册了预览服务的 dispose：插件禁用/重载会释放端口', async () => {
  const { apply, configRef } = await import('../src/host.js')
  const port = 5176
  const noop = { dispose() {} }
  const effects = []
  const ctx = {
    effect(fn, label) { effects.push({ label: String(label), result: fn() }); return noop },
    tools: { register: () => noop },
    skills: { registerProvider: () => noop },
    webServer: { register: () => noop },
    get: () => undefined,
  }
  apply(ctx, { previewPort: port })

  const entry = effects.find((e) => e.label.includes('preview server'))
  assert.ok(entry, '要注册 preview server 的 effect（否则重载后端口一直占着）')
  assert.equal(typeof entry.result, 'function', 'effect 要返回 disposer 函数')

  const started = await startServer(port)
  assert.equal(started.ok, true, `预览服务应能起来：${started.error || ''}`)
  assert.equal((await serverHealth(port)).up, true)

  await entry.result() // 宿主在插件卸载时调它
  assert.equal((await serverHealth(port)).up, false, 'disposer 调用后端口应释放')

  configRef.config = null
  await stopServer()
})
