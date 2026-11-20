/**
 * Netlify Function（新版运行时）：把 /api/* 请求转给共享的 handleApi，存储用 Netlify Blobs（强一致）。
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { handleApi } = require('../../lib/api')
const { createBlobStore } = require('../../lib/store-blobs')

let store

export default async (req, context) => {
  try {
    if (!store) store = createBlobStore()
    const url = new URL(req.url)
    const query = Object.fromEntries(url.searchParams)
    let body = {}
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const raw = await req.text()
      if (raw) body = JSON.parse(raw)
    }
    const result = await handleApi({
      method: req.method,
      pathname: url.pathname,
      query,
      body,
      ip: (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'unknown',
      origin: url.origin
    }, store)
    const headers = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, result.headers || {})
    return new Response(JSON.stringify(result.body), { status: result.status, headers })
  } catch (err) {
    const status = err && err.status ? err.status : 500
    return new Response(JSON.stringify({
      ok: false,
      code: err && err.code ? err.code : 'INTERNAL',
      message: err && err.message ? err.message : '服务器出错了'
    }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  }
}

export const config = { path: ['/api', '/api/*'] }
