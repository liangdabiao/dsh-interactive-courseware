// 课件放映厅 · 脚手架：把 skill 的三段固定代码落进课件工作目录。
// 纪律（SKILL.md 第 0 步）：只复制，不重写、不修改；已存在的不覆盖。
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLAYER_ASSET = fileURLToPath(new URL('../skills/interactive-courseware/assets/player.html', import.meta.url))
export const TEMPLATE_ASSET = fileURLToPath(new URL('../skills/interactive-courseware/assets/page-template.html', import.meta.url))
export const PACK_PY_ASSET = fileURLToPath(new URL('../skills/interactive-courseware/scripts/pack.py', import.meta.url))

const PIECES = [
  { from: TEMPLATE_ASSET, to: 'page-template.html', label: '页面骨架（附二）' },
  { from: PACK_PY_ASSET, to: 'pack.py', label: '打包脚本（附三）' },
  { from: PLAYER_ASSET, to: 'player.html', label: '播放器外壳（附一）' },
]

// 落三段固定代码。已存在的一律不覆盖（skill 纪律）。返回 { written[], existing[], dir }
export function scaffoldDeck(destDir) {
  if (!destDir || !String(destDir).trim()) throw new Error('scaffold 需要 dir（课件工作目录）。')
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
  const written = []
  const existing = []
  for (const p of PIECES) {
    const target = join(destDir, p.to)
    if (existsSync(target)) { existing.push(p.to); continue }
    copyFileSync(p.from, target)
    written.push(p.to)
  }
  return { dir: destDir, written, existing }
}
