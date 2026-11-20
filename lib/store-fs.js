/**
 * 本地 JSON 文件存储。厨房数据保存在 data/kitchens/<token>.json，
 * 邀请码索引在 data/codes.json。用临时文件再 rename，避免写到一半损坏。
 */
const fs = require('fs')
const path = require('path')

const TOKEN_RE = /^[a-f0-9]{32}$/
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/
const IMAGE_ID_RE = /^[a-f0-9]{32}$/

function createFsStore(rootDir) {
  const kitchensDir = path.join(rootDir, 'kitchens')
  const imagesDir = path.join(rootDir, 'images')
  const codesPath = path.join(rootDir, 'codes.json')

  function ensureDirs() {
    fs.mkdirSync(kitchensDir, { recursive: true })
  }

  function kitchenPath(token) {
    if (!TOKEN_RE.test(token)) {
      const err = new Error('无效的厨房链接')
      err.status = 400
      err.code = 'INVALID_TOKEN'
      throw err
    }
    return path.join(kitchensDir, token + '.json')
  }

  function imagePath(token, id) {
    if (!TOKEN_RE.test(token) || !IMAGE_ID_RE.test(id)) {
      const err = new Error('无效的图片')
      err.status = 400
      err.code = 'INVALID'
      throw err
    }
    return path.join(imagesDir, token, id)
  }

  function writeJsonAtomic(filePath, data) {
    const dir = path.dirname(filePath)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = filePath + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, filePath)
  }

  function readJson(filePath, fallback) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(raw)
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return fallback
      }
      throw err
    }
  }

  function readCodes() {
    const data = readJson(codesPath, {})
    return data && typeof data === 'object' ? data : {}
  }

  return {
    async getKitchen(token) {
      ensureDirs()
      const file = kitchenPath(token)
      if (!fs.existsSync(file)) {
        return null
      }
      return readJson(file, null)
    },

    async saveKitchen(kitchen) {
      ensureDirs()
      writeJsonAtomic(kitchenPath(kitchen.token), kitchen)
      const codes = readCodes()
      codes[kitchen.code] = kitchen.token
      writeJsonAtomic(codesPath, codes)
    },

    async getTokenByCode(code) {
      if (!CODE_RE.test(code)) {
        return null
      }
      const codes = readCodes()
      const token = codes[code]
      if (!token || !TOKEN_RE.test(token)) {
        return null
      }
      return token
    },

    async saveImage(token, id, buffer) {
      const file = imagePath(token, id)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = file + '.' + process.pid + '.tmp'
      fs.writeFileSync(tmp, buffer)
      fs.renameSync(tmp, file)
    },

    async getImage(token, id) {
      const file = imagePath(token, id)
      if (!fs.existsSync(file)) {
        return null
      }
      return { body: fs.readFileSync(file) }
    }
  }
}

module.exports = { createFsStore, TOKEN_RE, CODE_RE, IMAGE_ID_RE }
