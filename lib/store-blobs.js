/**
 * Netlify Blobs 存储适配。业务逻辑与 store-fs 相同，仅底层换成 Blobs。
 * 本地用 node server.js 时不会加载本文件；仅在 Netlify Functions 里使用。
 * @netlify/blobs 由 Netlify 运行时提供，不必在本地安装。
 */
const { TOKEN_RE, CODE_RE } = require('./store-fs')

function createBlobStore(getStoreImpl) {
  const getStore = getStoreImpl || defaultGetStore
  const store = getStore({
    name: 'sweet-kitchen',
    consistency: 'strong'
  })

  return {
    async getKitchen(token) {
      if (!TOKEN_RE.test(token)) {
        const err = new Error('无效的厨房链接')
        err.status = 400
        err.code = 'INVALID_TOKEN'
        throw err
      }
      const data = await store.get('kitchen:' + token, { type: 'json' })
      return data || null
    },

    async saveKitchen(kitchen) {
      if (typeof store.setJSON === 'function') {
        await store.setJSON('kitchen:' + kitchen.token, kitchen)
        await store.setJSON('code:' + kitchen.code, { token: kitchen.token })
      } else {
        const body = JSON.stringify(kitchen)
        await store.set('kitchen:' + kitchen.token, body, { type: 'json' })
        await store.set('code:' + kitchen.code, JSON.stringify({ token: kitchen.token }), { type: 'json' })
      }
    },

    async getTokenByCode(code) {
      if (!CODE_RE.test(code)) {
        return null
      }
      const row = await store.get('code:' + code, { type: 'json' })
      if (!row || !row.token || !TOKEN_RE.test(row.token)) {
        return null
      }
      return row.token
    },

    async saveImage(token, id, buffer, contentType) {
      const key = 'img:' + token + ':' + id
      const options = contentType ? { metadata: { contentType: contentType } } : undefined
      await store.set(key, buffer, options)
    },

    async getImage(token, id) {
      const key = 'img:' + token + ':' + id
      if (typeof store.getWithMetadata === 'function') {
        const result = await store.getWithMetadata(key, { type: 'arrayBuffer' })
        if (!result || result.data == null) {
          return null
        }
        const body = Buffer.from(result.data)
        const contentType = result.metadata && result.metadata.contentType
        return { body: body, contentType: contentType }
      }
      const data = await store.get(key, { type: 'arrayBuffer' })
      if (data == null) {
        return null
      }
      return { body: Buffer.from(data) }
    }
  }
}

function defaultGetStore(options) {
  const blobs = require('@netlify/blobs')
  return blobs.getStore(options)
}

module.exports = { createBlobStore }
