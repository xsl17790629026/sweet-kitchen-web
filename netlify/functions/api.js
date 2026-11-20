/**
 * Netlify Function 适配层：把请求转给共享的 handleApi，存储用 Netlify Blobs。
 */
const { handleApi } = require('../../lib/api')
const { createBlobStore } = require('../../lib/store-blobs')
const { clientIp } = require('../../lib/ratelimit')

let store

function getStore() {
  if (!store) {
    store = createBlobStore()
  }
  return store
}

function normalizePath(event) {
  let path = event.path || event.rawUrl || ''
  try {
    if (path.indexOf('http') === 0) {
      path = new URL(path).pathname
    }
  } catch (err) {}
  path = path.replace(/^\/\.netlify\/functions\/api/, '')
  if (path.indexOf('/api/') === 0) {
    return path
  }
  if (!path || path === '/') {
    return '/api'
  }
  if (path.charAt(0) !== '/') {
    path = '/' + path
  }
  return '/api' + path
}

function requestOrigin(event) {
  const headers = event.headers || {}
  const proto = (headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https').split(',')[0].trim()
  const host = (headers['x-forwarded-host'] || headers['X-Forwarded-Host'] || headers.host || headers.Host || '').split(',')[0].trim()
  if (!host) {
    return ''
  }
  return proto + '://' + host
}

function parseBody(event) {
  if (!event.body) {
    return {}
  }
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body
  if (!raw) {
    return {}
  }
  return JSON.parse(raw)
}

exports.handler = async function (event) {
  try {
    const result = await handleApi({
      method: event.httpMethod || event.method || 'GET',
      pathname: normalizePath(event),
      query: event.queryStringParameters || {},
      body: parseBody(event),
      ip: clientIp({ headers: event.headers || {}, socket: null }),
      origin: requestOrigin(event)
    }, getStore())

    return {
      statusCode: result.status,
      headers: result.headers,
      body: JSON.stringify(result.body)
    }
  } catch (err) {
    const status = err && err.status ? err.status : 500
    return {
      statusCode: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        ok: false,
        code: err && err.code ? err.code : 'INTERNAL',
        message: err && err.message ? err.message : '服务器出错了'
      })
    }
  }
}
