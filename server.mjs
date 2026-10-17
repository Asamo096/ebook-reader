import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(process.cwd(), 'dist')
const port = Number(process.env.PORT) || 5173
const host = process.env.HOST || '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.epub': 'application/epub+zip',
  '.mobi': 'application/x-mobipocket-ebook',
  '.azw3': 'application/vnd.amazon.ebook',
  '.bcmap': 'application/octet-stream',
}

if (!existsSync(join(root, 'index.html'))) {
  console.error('未找到 dist/index.html，请先运行：npm run build')
  process.exit(1)
}

const send = (res, status, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type })
  res.end(body)
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`)
    const decoded = decodeURIComponent(url.pathname)
    if (decoded.includes('\0')) return send(res, 400, 'Bad request')

    let filePath = normalize(join(root, decoded))
    if (!filePath.startsWith(root)) return send(res, 403, 'Forbidden')

    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(root, 'index.html')
    }

    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const stat = statSync(filePath)
    const isHtml = filePath.endsWith('.html')
    const cache = isHtml
      ? 'no-cache'
      : filePath.includes(`${join(root, 'assets')}`)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600'

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(filePath).pipe(res)
  } catch (error) {
    console.error(error)
    send(res, 500, 'Internal server error')
  }
})

server.listen(port, host, () => {
  console.log(`\n  墨阅已启动：http://${host}:${port}\n`)
})
