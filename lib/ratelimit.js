/**
 * 进程内简单限流，按 IP + 动作分组。重启后计数清零，足以挡住随手乱扫。
 */
function createRateLimiter() {
  const buckets = {}

  function prune(now) {
    const keys = Object.keys(buckets)
    for (let i = 0; i < keys.length; i++) {
      if (buckets[keys[i]].resetAt <= now) {
        delete buckets[keys[i]]
      }
    }
  }

  /**
   * @param {string} key
   * @param {number} limit 窗口内最多次数
   * @param {number} windowMs 窗口长度
   * @returns {{ok:boolean, retryAfter?:number}}
   */
  function take(key, limit, windowMs) {
    const now = Date.now()
    if (Math.random() < 0.02) {
      prune(now)
    }
    let bucket = buckets[key]
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets[key] = bucket
    }
    if (bucket.count >= limit) {
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      }
    }
    bucket.count += 1
    return { ok: true }
  }

  return { take }
}

function clientIp(req) {
  const forwarded = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])
  if (forwarded) {
    return String(forwarded).split(',')[0].trim()
  }
  if (req.headers && req.headers['x-real-ip']) {
    return String(req.headers['x-real-ip']).trim()
  }
  if (req.socket && req.socket.remoteAddress) {
    return req.socket.remoteAddress
  }
  return 'unknown'
}

module.exports = { createRateLimiter, clientIp }
