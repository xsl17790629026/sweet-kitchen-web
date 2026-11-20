/**
 * 菜品图片：校验、解码、读写。图片单独存放，不写入厨房 JSON。
 */
const crypto = require('crypto')
const { TOKEN_RE, IMAGE_ID_RE } = require('./store-fs')

const MAX_IMAGE_BYTES = Math.floor(1.5 * 1024 * 1024)

function fail(status, code, message) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

function sniffImageType(buf) {
  if (!buf || buf.length < 12) {
    return null
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'image/png'
  }
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return 'image/webp'
  }
  return null
}

function decodeImagePayload(body) {
  const src = body || {}
  let raw = src.image || src.data || src.base64 || ''
  if (typeof raw !== 'string' || !raw.trim()) {
    throw fail(400, 'INVALID', '请先选择一张图片')
  }
  raw = raw.trim()
  const dataUrl = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(raw)
  const b64 = (dataUrl ? dataUrl[2] : raw).replace(/\s+/g, '')
  if (!b64) {
    throw fail(400, 'INVALID', '请先选择一张图片')
  }
  let buffer
  try {
    buffer = Buffer.from(b64, 'base64')
  } catch (err) {
    throw fail(400, 'INVALID', '图片数据不正确')
  }
  if (!buffer.length) {
    throw fail(400, 'INVALID', '图片数据不正确')
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw fail(413, 'PAYLOAD_TOO_LARGE', '图片太大了，请换一张小一点的')
  }
  const contentType = sniffImageType(buffer)
  if (!contentType) {
    throw fail(400, 'INVALID', '只支持 JPEG、PNG 或 WebP 图片')
  }
  return { buffer: buffer, contentType: contentType }
}

async function uploadImage(store, token, body) {
  if (!TOKEN_RE.test(token || '')) {
    throw fail(400, 'INVALID_TOKEN', '无效的厨房链接')
  }
  const kitchen = await store.getKitchen(token)
  if (!kitchen) {
    throw fail(404, 'NOT_FOUND', '没有找到这个厨房，请检查链接或邀请码')
  }
  const decoded = decodeImagePayload(body)
  const id = crypto.randomBytes(16).toString('hex')
  await store.saveImage(token, id, decoded.buffer, decoded.contentType)
  return {
    id: id,
    url: '/api/kitchens/' + token + '/images/' + id,
    contentType: decoded.contentType,
    size: decoded.buffer.length
  }
}

async function loadImage(store, token, id) {
  if (!TOKEN_RE.test(token || '')) {
    throw fail(400, 'INVALID_TOKEN', '无效的厨房链接')
  }
  if (!IMAGE_ID_RE.test(id || '')) {
    throw fail(400, 'INVALID', '无效的图片')
  }
  const image = await store.getImage(token, id)
  if (!image || image.body == null) {
    throw fail(404, 'NOT_FOUND', '没有找到这张图片')
  }
  const body = Buffer.isBuffer(image.body) ? image.body : Buffer.from(image.body)
  const contentType = image.contentType || sniffImageType(body)
  if (!contentType) {
    throw fail(404, 'NOT_FOUND', '没有找到这张图片')
  }
  return { body: body, contentType: contentType }
}

module.exports = {
  IMAGE_ID_RE,
  MAX_IMAGE_BYTES,
  sniffImageType,
  decodeImagePayload,
  uploadImage,
  loadImage
}
