/**
 * 共享 API 路由。server.js 与 Netlify Function 都调用 handleApi。
 * 输入：{ method, pathname, query, body, ip, origin }
 * 输出：{ status, headers, body }
 */
const kitchenLib = require('./kitchen')
const imageLib = require('./images')
const { createRateLimiter } = require('./ratelimit')

const limiter = createRateLimiter()
const locks = {}

function withLock(token, fn) {
  const key = token || '__global__'
  const prev = locks[key] || Promise.resolve()
  const current = prev.then(fn, fn)
  locks[key] = current.then(function () {}, function () {})
  return current
}

function json(status, body, extraHeaders) {
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, extraHeaders || {})
  return { status: status, headers: headers, body: body }
}

function errorToResponse(err) {
  const status = err && err.status ? err.status : 500
  const message = err && err.message ? err.message : '服务器出错了，请稍后再试'
  const code = err && err.code ? err.code : 'INTERNAL'
  if (status >= 500) {
    console.error(err)
  }
  return json(status, { ok: false, code: code, message: message })
}

function checkLimit(ip, name, limit, windowMs) {
  const result = limiter.take(ip + ':' + name, limit, windowMs)
  if (!result.ok) {
    const err = new Error('操作太频繁，请 ' + result.retryAfter + ' 秒后再试')
    err.status = 429
    err.code = 'RATE_LIMIT'
    err.retryAfter = result.retryAfter
    throw err
  }
}

function tokenFromPath(pathname, prefix) {
  const rest = pathname.slice(prefix.length)
  const parts = rest.split('/').filter(Boolean)
  return parts[0] || ''
}

function pathParts(pathname, prefix) {
  return pathname.slice(prefix.length).split('/').filter(Boolean)
}

async function handleApi(request, store) {
  const method = (request.method || 'GET').toUpperCase()
  const pathname = request.pathname || '/'
  const ip = request.ip || 'unknown'
  const origin = request.origin || ''
  const query = request.query || {}
  const body = request.body || {}

  try {
    if (pathname === '/api/health' && method === 'GET') {
      return json(200, { ok: true, name: '甜蜜厨房' })
    }

    if (pathname === '/api/kitchens' && method === 'POST') {
      checkLimit(ip, 'create', 8, 60 * 60 * 1000)
      const kitchen = await kitchenLib.createKitchen(store)
      return json(201, Object.assign({ ok: true }, kitchenLib.publicState(kitchen, origin)))
    }

    if (pathname === '/api/kitchens/join' && method === 'POST') {
      checkLimit(ip, 'join', 20, 60 * 60 * 1000)
      const kitchen = await kitchenLib.joinByCode(store, body.code)
      return json(200, Object.assign({ ok: true }, kitchenLib.publicState(kitchen, origin)))
    }

    if (pathname.indexOf('/api/kitchens/') === 0) {
      const parts = pathParts(pathname, '/api/kitchens/')
      const token = parts[0]
      if (!token) {
        return json(400, { ok: false, code: 'INVALID_TOKEN', message: '无效的厨房链接' })
      }

      if (parts.length === 1 && method === 'GET') {
        checkLimit(ip, 'read', 120, 60 * 1000)
        const kitchen = await kitchenLib.requireKitchen(store, token)
        const since = parseInt(query.since, 10)
        if (since && kitchen.updatedAt && kitchen.updatedAt <= since) {
          return json(200, { ok: true, unchanged: true, updatedAt: kitchen.updatedAt })
        }
        return json(200, Object.assign({ ok: true }, kitchenLib.publicState(kitchen, origin)))
      }

      if (parts.length === 3 && parts[1] === 'images' && method === 'GET') {
        checkLimit(ip, 'image', 180, 60 * 1000)
        const image = await imageLib.loadImage(store, token, parts[2])
        return {
          status: 200,
          raw: true,
          headers: {
            'Content-Type': image.contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff'
          },
          body: image.body
        }
      }

      checkLimit(ip, 'write', 90, 60 * 1000)

      return await withLock(token, async function () {
        if (parts.length === 2 && parts[1] === 'images' && method === 'POST') {
          const saved = await imageLib.uploadImage(store, token, body)
          return json(201, {
            ok: true,
            id: saved.id,
            url: saved.url,
            contentType: saved.contentType
          })
        }

        if (parts.length === 2 && parts[1] === 'dishes' && method === 'POST') {
          const kitchen = await kitchenLib.upsertDish(store, token, body)
          return json(200, Object.assign({ ok: true }, kitchenLib.publicState(kitchen, origin)))
        }

        if (parts.length === 3 && parts[1] === 'dishes' && parts[2] === 'restore' && method === 'POST') {
          const kitchen = await kitchenLib.restoreDishes(store, token)
          return json(200, Object.assign({ ok: true }, kitchenLib.publicState(kitchen, origin)))
        }

        if (parts.length === 3 && parts[1] === 'dishes' && method === 'DELETE') {
          const kitchen = await kitchenLib.deleteDish(store, token, decodeURIComponent(parts[2]))
          return json(200, Object.assign({ ok: true }, kitchenLib.publicState(kitchen, origin)))
        }

        if (parts.length === 2 && parts[1] === 'cart' && method === 'POST') {
          const kitchen = await kitchenLib.changeCart(store, token, body)
          return json(200, Object.assign({ ok: true }, kitchenLib.publicState(kitchen, origin)))
        }

        if (parts.length === 2 && parts[1] === 'orders' && method === 'POST') {
          const kitchen = await kitchenLib.submitOrder(store, token, body.notes)
          return json(200, Object.assign({ ok: true }, kitchenLib.publicState(kitchen, origin)))
        }

        if (parts.length === 3 && parts[1] === 'orders' && method === 'POST') {
          const orderId = decodeURIComponent(parts[2])
          let kitchen
          if (body.action === 'delete') {
            kitchen = await kitchenLib.deleteOrder(store, token, orderId)
          } else {
            kitchen = await kitchenLib.markOrderDone(store, token, orderId)
          }
          return json(200, Object.assign({ ok: true }, kitchenLib.publicState(kitchen, origin)))
        }

        if (parts.length === 3 && parts[1] === 'orders' && method === 'DELETE') {
          const kitchen = await kitchenLib.deleteOrder(store, token, decodeURIComponent(parts[2]))
          return json(200, Object.assign({ ok: true }, kitchenLib.publicState(kitchen, origin)))
        }

        return json(404, { ok: false, code: 'NOT_FOUND', message: '接口不存在' })
      })
    }

    return json(404, { ok: false, code: 'NOT_FOUND', message: '接口不存在' })
  } catch (err) {
    const res = errorToResponse(err)
    if (err && err.retryAfter) {
      res.headers['Retry-After'] = String(err.retryAfter)
    }
    return res
  }
}

module.exports = { handleApi }
