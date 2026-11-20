/**
 * 甜蜜厨房本地 / 自建服务器入口。
 * 启动：node server.js
 * 端口：默认 8787，可用环境变量 PORT 覆盖。
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')

const { createFsStore } = require('./lib/store-fs')
const { handleApi } = require('./lib/api')
const { clientIp } = require('./lib/ratelimit')

const ROOT = __dirname
const PUBLIC_DIR = path.join(ROOT, 'public')
const DATA_DIR = path.join(ROOT, 'data')
const PORT = parseInt(process.env.PORT, 10) || 8787
const MAX_BODY = 200 * 1024

const store = createFsStore(DATA_DIR)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
}

function send(res, status, headers, body) {
  const finalHeaders = Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers || {})
  res.writeHead(status, finalHeaders)
  res.end(body)
}

function sendJson(res, result) {
  send(res, result.status, result.headers, JSON.stringify(result.body))
}

function requestOrigin(req) {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const proto = xfProto || (req.socket && req.socket.encrypted ? 'https' : 'http')
  const xfHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()
  const host = xfHost || String(req.headers.host || 'localhost:' + PORT)
  return proto + '://' + host
}

function safePublicFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const relative = decoded.replace(/^\/+/, '')
  const abs = path.normalize(path.join(PUBLIC_DIR, relative))
  if (abs !== PUBLIC_DIR && abs.indexOf(PUBLIC_DIR + path.sep) !== 0) {
    return null
  }
  return abs
}

function serveStatic(req, res, urlPath) {
  let filePath
  if (urlPath === '/' || urlPath.indexOf('/k/') === 0) {
    filePath = path.join(PUBLIC_DIR, 'index.html')
  } else {
    filePath = safePublicFile(urlPath)
    if (!filePath) {
      send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad request')
      return
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html')
    }
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found')
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    const type = MIME[ext] || 'application/octet-stream'
    const headers = { 'Content-Type': type }
    if (ext === '.html') {
      headers['Cache-Control'] = 'no-cache'
    } else {
      headers['Cache-Control'] = 'public, max-age=3600'
    }
    send(res, 200, headers, data)
  })
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = []
    let size = 0
    req.on('data', function (chunk) {
      size += chunk.length
      if (size > MAX_BODY) {
        const err = new Error('请求内容过大')
        err.status = 413
        err.code = 'PAYLOAD_TOO_LARGE'
        reject(err)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', function () {
      if (!chunks.length) {
        resolve({})
        return
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        const e = new Error('JSON 格式不正确')
        e.status = 400
        e.code = 'BAD_JSON'
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

const server = http.createServer(async function (req, res) {
  const host = req.headers.host || 'localhost:' + PORT
  let parsed
  try {
    parsed = new URL(req.url || '/', 'http://' + host)
  } catch (err) {
    send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad request')
    return
  }

  const pathname = parsed.pathname

  if (req.method === 'OPTIONS' && pathname.indexOf('/api/') === 0) {
    send(res, 204, { 'Allow': 'GET,POST,DELETE,OPTIONS' }, '')
    return
  }

  if (pathname.indexOf('/api/') === 0) {
    try {
      const body = (req.method === 'GET' || req.method === 'HEAD') ? {} : await readBody(req)
      const query = {}
      parsed.searchParams.forEach(function (value, key) {
        query[key] = value
      })
      const result = await handleApi({
        method: req.method,
        pathname: pathname,
        query: query,
        body: body,
        ip: clientIp(req),
        origin: requestOrigin(req)
      }, store)
      sendJson(res, result)
    } catch (err) {
      const status = err && err.status ? err.status : 500
      sendJson(res, {
        status: status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: { ok: false, code: err && err.code ? err.code : 'INTERNAL', message: err && err.message ? err.message : '服务器出错了' }
      })
    }
    return
  }

  serveStatic(req, res, pathname)
})

server.listen(PORT, '0.0.0.0', function () {
  console.log('甜蜜厨房已启动：http://0.0.0.0:' + PORT)
})
