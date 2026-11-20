// 课件放映厅 · 面板开发预览：假 ctx 拉起 lib/api.js 路由，浏览器可直接验收面板。
// 用法：node scripts/panel-dev.mjs [--port 8899] [--preview <端口>]
import http from 'node:http'
import { argOf } from './args.mjs'

const port = Number(argOf('--port', 8899))
const configRef = {
  config: {
    previewPort: Number(argOf('--preview', 5100)),
    _version: '0.1.0-dev',
  },
}

const { registerApi } = await import('../lib/api.js')
const { seedSamples } = await import('../lib/archive.js')
const { fileURLToPath } = await import('node:url')
const examples = fileURLToPath(new URL('../skills/interactive-courseware/examples/', import.meta.url))
configRef.seedPromise = seedSamples(examples).catch(() => {})

const ctx = {
  get: () => undefined, // requestRejection 缺席 → 放行（对齐 dsh 0.2.x 行为）
  webServer: {
    register(route) {
      return http.createServer((req, res) => route.handler(req, res)).listen(port, '127.0.0.1')
    },
  },
}
registerApi(ctx, { configRef })
console.log(`面板开发预览：http://127.0.0.1:${port}/dsh-interactive-courseware/`)
