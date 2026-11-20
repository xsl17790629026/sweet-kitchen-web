/**
 * 厨房业务逻辑：创建/加入、菜谱、点菜单、订单。
 * 不依赖具体存储，store 需提供 getKitchen / saveKitchen / getTokenByCode。
 */
const crypto = require('crypto')
const seed = require('./dishes')
const { TOKEN_RE, CODE_RE } = require('./store-fs')

const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function now() {
  return Date.now()
}

function randomToken() {
  return crypto.randomBytes(16).toString('hex')
}

function randomCode() {
  const bytes = crypto.randomBytes(8)
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS.charAt(bytes[i] % CODE_CHARS.length)
  }
  return code
}

function fail(status, code, message) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function publicState(kitchen, origin) {
  return {
    token: kitchen.token,
    code: kitchen.code,
    shareUrl: origin ? origin.replace(/\/$/, '') + '/k/' + kitchen.token : '',
    createdAt: kitchen.createdAt,
    updatedAt: kitchen.updatedAt,
    dishes: kitchen.dishes || [],
    cart: kitchen.cart || { items: [], notes: '' },
    orders: kitchen.orders || []
  }
}

function seedDishes() {
  return seed.dishes.map(function (dish, index) {
    return Object.assign({}, clone(dish), { seq: index + 1 })
  })
}

function cleanCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

async function uniqueCode(store) {
  for (let i = 0; i < 10; i++) {
    const code = randomCode()
    const existed = await store.getTokenByCode(code)
    if (!existed) {
      return code
    }
  }
  throw fail(500, 'CODE_BUSY', '邀请码生成失败，请再试一次')
}

function emptyKitchen(token, code, createdAt) {
  return {
    token: token,
    code: code,
    createdAt: createdAt,
    updatedAt: createdAt,
    dishes: seedDishes(),
    cart: { items: [], notes: '' },
    orders: []
  }
}

async function requireKitchen(store, token) {
  if (!TOKEN_RE.test(token || '')) {
    throw fail(400, 'INVALID_TOKEN', '无效的厨房链接')
  }
  const kitchen = await store.getKitchen(token)
  if (!kitchen) {
    throw fail(404, 'NOT_FOUND', '没有找到这个厨房，请检查链接或邀请码')
  }
  return kitchen
}

async function createKitchen(store) {
  const token = randomToken()
  const code = await uniqueCode(store)
  const createdAt = now()
  const kitchen = emptyKitchen(token, code, createdAt)
  await store.saveKitchen(kitchen)
  return kitchen
}

async function joinByCode(store, rawCode) {
  const code = cleanCode(rawCode)
  if (!CODE_RE.test(code)) {
    throw fail(400, 'INVALID_CODE', '请输入 6 位邀请码')
  }
  const token = await store.getTokenByCode(code)
  if (!token) {
    throw fail(404, 'NOT_FOUND', '没有找到这个邀请码，请和对方确认后再试')
  }
  return requireKitchen(store, token)
}

function sanitizeDish(raw, fallbackId, seq) {
  const src = raw || {}
  const time = parseInt(src.time, 10)
  const ingredients = Array.isArray(src.ingredients) ? src.ingredients : []
  const steps = Array.isArray(src.steps) ? src.steps : []
  const dish = {
    id: String(src.id || fallbackId || 'dish-' + now()).slice(0, 40),
    name: String(src.name || '').trim().slice(0, 20),
    emoji: String(src.emoji || '🍽️').trim().slice(0, 8) || '🍽️',
    category: String(src.category || '家常菜').slice(0, 10),
    desc: String(src.desc || '').trim().slice(0, 40),
    difficulty: String(src.difficulty || '简单').slice(0, 4),
    time: time > 0 ? time : 20,
    ingredients: ingredients.map(function (line) {
      return String(line).trim()
    }).filter(Boolean).slice(0, 40),
    steps: steps.map(function (line) {
      return String(line).trim()
    }).filter(Boolean).slice(0, 40)
  }
  if (typeof seq === 'number') {
    dish.seq = seq
  } else if (typeof src.seq === 'number') {
    dish.seq = src.seq
  }
  return dish
}

function sortDishes(list) {
  return (list || []).slice().sort(function (a, b) {
    const sa = typeof a.seq === 'number' ? a.seq : 0
    const sb = typeof b.seq === 'number' ? b.seq : 0
    if (sa !== sb) {
      return sa - sb
    }
    return String(a.id).localeCompare(String(b.id))
  })
}

async function upsertDish(store, token, raw) {
  const kitchen = await requireKitchen(store, token)
  const dish = sanitizeDish(raw, 'dish-' + now(), -now())
  if (!dish.name) {
    throw fail(400, 'INVALID', '菜名不能为空')
  }
  const list = kitchen.dishes || []
  let found = false
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === dish.id) {
      dish.seq = list[i].seq
      list[i] = dish
      found = true
      break
    }
  }
  if (!found) {
    list.unshift(dish)
  }
  kitchen.dishes = sortDishes(list)
  kitchen.updatedAt = now()
  await store.saveKitchen(kitchen)
  return kitchen
}

async function deleteDish(store, token, id) {
  const kitchen = await requireKitchen(store, token)
  const dishId = String(id || '')
  kitchen.dishes = (kitchen.dishes || []).filter(function (item) {
    return item.id !== dishId
  })
  const cart = kitchen.cart || { items: [], notes: '' }
  cart.items = (cart.items || []).filter(function (item) {
    return item.id !== dishId
  })
  kitchen.cart = cart
  kitchen.updatedAt = now()
  await store.saveKitchen(kitchen)
  return kitchen
}

async function restoreDishes(store, token) {
  const kitchen = await requireKitchen(store, token)
  kitchen.dishes = seedDishes()
  kitchen.updatedAt = now()
  await store.saveKitchen(kitchen)
  return kitchen
}

function applyCartChange(items, id, delta, setTo) {
  const next = (items || []).map(function (item) {
    return { id: item.id, quantity: item.quantity }
  })
  let found = false
  for (let i = 0; i < next.length; i++) {
    if (next[i].id === id) {
      found = true
      if (typeof setTo === 'number') {
        next[i].quantity = setTo
      } else {
        next[i].quantity += Number(delta) || 0
      }
      if (next[i].quantity <= 0) {
        next.splice(i, 1)
      }
      break
    }
  }
  if (!found) {
    const qty = typeof setTo === 'number' ? setTo : Number(delta) || 0
    if (qty > 0) {
      next.push({ id: id, quantity: qty })
    }
  }
  return next
}

async function changeCart(store, token, payload) {
  const kitchen = await requireKitchen(store, token)
  const cart = kitchen.cart || { items: [], notes: '' }
  const action = payload && payload.action
  if (action === 'notes') {
    cart.notes = String((payload && payload.notes) || '').trim().slice(0, 120)
  } else if (action === 'clear') {
    cart.items = []
    cart.notes = ''
  } else if (action === 'set' && payload) {
    if (Array.isArray(payload.items)) {
      cart.items = payload.items.map(function (item) {
        return { id: String(item.id), quantity: Math.max(0, parseInt(item.quantity, 10) || 0) }
      }).filter(function (item) {
        return item.id && item.quantity > 0
      }).slice(0, 80)
    }
    if (payload.notes != null) {
      cart.notes = String(payload.notes).trim().slice(0, 120)
    }
  } else {
    const id = String((payload && payload.id) || '')
    if (!id) {
      throw fail(400, 'INVALID', '缺少菜品 ID')
    }
    cart.items = applyCartChange(cart.items, id, payload.delta, payload.setTo)
  }
  kitchen.cart = cart
  kitchen.updatedAt = now()
  await store.saveKitchen(kitchen)
  return kitchen
}

function cartView(kitchen) {
  const dishes = kitchen.dishes || []
  const map = {}
  for (let i = 0; i < dishes.length; i++) {
    map[dishes[i].id] = dishes[i]
  }
  const items = (kitchen.cart && kitchen.cart.items) || []
  const snapshot = []
  for (let j = 0; j < items.length; j++) {
    const dish = map[items[j].id]
    if (!dish || !items[j].quantity) {
      continue
    }
    snapshot.push({
      id: dish.id,
      name: dish.name,
      emoji: dish.emoji,
      time: dish.time,
      difficulty: dish.difficulty,
      quantity: items[j].quantity
    })
  }
  return snapshot
}

async function submitOrder(store, token, notes) {
  const kitchen = await requireKitchen(store, token)
  const items = cartView(kitchen)
  if (!items.length) {
    throw fail(400, 'EMPTY_CART', '还没点菜哦')
  }
  const text = String(notes != null ? notes : (kitchen.cart && kitchen.cart.notes) || '').trim().slice(0, 120)
  const createdAt = now()
  const order = {
    id: 'order-' + createdAt + '-' + crypto.randomBytes(3).toString('hex'),
    createdAt: createdAt,
    status: 'pending',
    notes: text,
    items: items,
    doneAt: 0
  }
  kitchen.orders = [order].concat(kitchen.orders || []).slice(0, 200)
  kitchen.cart = { items: [], notes: '' }
  kitchen.updatedAt = createdAt
  await store.saveKitchen(kitchen)
  return kitchen
}

async function markOrderDone(store, token, orderId) {
  const kitchen = await requireKitchen(store, token)
  const id = String(orderId || '')
  let found = false
  const orders = kitchen.orders || []
  for (let i = 0; i < orders.length; i++) {
    if (orders[i].id === id) {
      orders[i].status = 'done'
      orders[i].doneAt = now()
      found = true
      break
    }
  }
  if (!found) {
    throw fail(404, 'NOT_FOUND', '没有找到这笔订单')
  }
  kitchen.orders = orders
  kitchen.updatedAt = now()
  await store.saveKitchen(kitchen)
  return kitchen
}

async function deleteOrder(store, token, orderId) {
  const kitchen = await requireKitchen(store, token)
  const id = String(orderId || '')
  const before = (kitchen.orders || []).length
  kitchen.orders = (kitchen.orders || []).filter(function (item) {
    return item.id !== id
  })
  if (kitchen.orders.length === before) {
    throw fail(404, 'NOT_FOUND', '没有找到这笔订单')
  }
  kitchen.updatedAt = now()
  await store.saveKitchen(kitchen)
  return kitchen
}

const CATEGORIES = seed.categories.slice()

module.exports = {
  TOKEN_RE,
  CODE_RE,
  CATEGORIES,
  publicState,
  seedDishes,
  cleanCode,
  createKitchen,
  joinByCode,
  requireKitchen,
  upsertDish,
  deleteDish,
  restoreDishes,
  changeCart,
  submitOrder,
  markOrderDone,
  deleteOrder
}
