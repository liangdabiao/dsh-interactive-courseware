// 课件放映厅 · 打包：把各页内嵌进播放器外壳，得到可单独分发的 课件.html。
// 等价移植 skill 自带的 pack.py（pack.py 逻辑一字不差照搬，只换了语言——
// dsh 环境必有 Node，Python 不一定有）。转义规则同 pack.py：< → \u003c，
// 防止页面里的 </script> 截断播放器自己的脚本；另转义 U+2028/2029 防意外断串。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDeck } from './deck.js'

// DECK.pages 的 src 引用，全局替换：DECK.pages 每一页都要内嵌。
// 同时兼容播放器原文风格 `src: "x.html"` 与 JSON 紧凑风格 `"src":"x.html"`。
const SRC_RE = /(\bsrc\s*"?\s*:\s*)(["'])([^"'<>]+\.html)\2/g

function embedPage(text) {
  return JSON.stringify(text)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

// 打包一个课件目录。返回 { ok, outFile, pages, bytes } 或 { ok: false, error }。
export function packDeck(dir, { outFile = '课件.html' } = {}) {
  const indexFile = join(dir, 'index.html')
  if (!existsSync(indexFile)) return { ok: false, error: `目录里没有 index.html（播放器）：${dir}` }
  const shell = readFileSync(indexFile, 'utf8')
  const deck = parseDeck(shell)
  if (!deck) return { ok: false, error: 'index.html 里解析不出 DECK，没法确定要内嵌哪些页面' }

  let count = 0
  const missing = []
  const out = shell.replace(SRC_RE, (whole, prefix, quote, src) => {
    const file = join(dir, src)
    if (!existsSync(file)) { missing.push(src); return whole }
    count++
    return prefix + quote + embedPage(readFileSync(file, 'utf8')) + quote
  })
  if (missing.length) return { ok: false, error: `找不到页面文件：${missing.join('、')}（先补齐再打包）` }
  if (!count) return { ok: false, error: '没有在 index.html 的 DECK.pages 里找到 src: "xxx.html"' }

  const target = join(dir, outFile)
  writeFileSync(target, out, 'utf8')
  return { ok: true, outFile: target, pages: count, bytes: Buffer.byteLength(out, 'utf8') }
}

// 打包产物是否真的自包含（抽查：DECK.pages 的 src 已被页面全文替换）
export function packedSelfContained(packedHtml) {
  return !/\bsrc\s*:\s*(["'])[^"'<>]+\.html\1/.test(String(packedHtml))
}
