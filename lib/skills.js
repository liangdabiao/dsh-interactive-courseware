// 课件放映厅 · 技能快照提供方。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true }

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return null
  const block = m[1]
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  let description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2') || null
  if (!description) {
    const lines = block.split(/\r?\n/)
    const start = lines.findIndex((l) => /^description:\s*>/.test(l))
    if (start !== -1) {
      const collected = []
      for (let i = start + 1; i < lines.length; i++) {
        if (/^\S/.test(lines[i])) break
        collected.push(lines[i].replace(/^\s+/, ''))
      }
      description = collected.join(' ').trim()
    }
  }
  if (!name || !description) return null
  return { name, description, body: text.slice(m[0].length) }
}

export function readDir(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sDir = join(dir, entry.name)
    const skillFile = join(sDir, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const parsed = parse(skillFile)
    if (parsed) out.push({ dir: sDir, file: skillFile, ...parsed, dirName: entry.name })
  }
  return out
}

function addendum(skill) {
  return [
    '',
    '---',
    '',
    '## 在 DSH 插件里使用',
    '',
    `- 本技能目录：\`${skill.dir}\`（含 \`assets/player.html\`、\`assets/page-template.html\`、\`scripts/pack.py\` 三段固定代码，以及 \`examples/\` 两套成品范例课件）。`,
    '- **你的 bash 沙箱读不到插件安装目录**——开工前先把整个技能目录复制到当前工作区，之后 \$SKILL_DIR 就用工作区副本的路径：',
    '  ```bash',
    `  cp -r "${skill.dir}" ./interactive-courseware-skill`,
    '  ```',
    '- 工作流程（文件模式）：先出《课件设计蓝图》停下等确认 → `courseware scaffold` 落三段固定代码 → 按 blueprint 连续生成全部 page-XX.html → `courseware check` 机械自查（warns 逐条修）→ `courseware pack` 打包单文件 → `courseware save` 存证 → `courseware serve`，告知用户去侧栏「课件放映厅」预览。',
    '- 写每页时从 `page-template.html` 复制起头，只改 `<title>`、本页样式、舞台内容、本页脚本四处；三段公共代码与第 1 页一字不差。',
    '- 成品长什么样：插件把两套真实范例（阿基米德与浮力 / 勾股定理双证记）种在面板「课件档案」里，用户可现场翻页预览；工作区副本 `interactive-courseware-skill/examples/` 里可以读它们的源码。',
    '',
  ].join('\n')
}

export function createSkillProvider(dirs) {
  const list = [].concat(dirs)
  const candidate = (s) => ({
    name: s.name, description: s.description, path: s.file,
    invocation: INVOCATION, source: 'bundled', provider: 'dsh-interactive-courseware', rank: RANK,
    locator: s.dir, resourceBase: { kind: 'directory', path: s.dir },
  })

  return {
    name: 'dsh-interactive-courseware',
    async list() { return list.flatMap(readDir).map(candidate) },
    async get(c) {
      const s = list.flatMap(readDir).find((x) => x.dir === c.locator && x.name === c.name)
      if (!s) return undefined
      const content = s.body + addendum(s)
      const { rank, locator, ...summary } = candidate(s)
      return { ...summary, content }
    },
  }
}

export { addendum }
