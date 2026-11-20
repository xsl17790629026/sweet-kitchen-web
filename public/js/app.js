/* 甜蜜厨房前端：兼容微信内置浏览器与手机 Chrome / Safari。不使用过新语法，不加载外部脚本。 */
(function () {
  'use strict';

  var LS_NICK = 'sk_nickname';
  var LS_TOKEN = 'sk_last_token';
  var POLL_MS = 2500;
  var CATEGORIES = ['全部', '家常菜', '汤', '主食', '甜品', '饮品'];
  var DISH_CATEGORIES = ['家常菜', '汤', '主食', '甜品', '饮品'];
  var DIFFICULTIES = ['简单', '中等', '稍难'];

  var appEl = document.getElementById('app');
  var toastEl = document.getElementById('toast');
  var pollTimer = null;
  var notesFocused = false;
  var toastTimer = null;

  var state = {
    ready: false,
    token: '',
    code: '',
    shareUrl: '',
    dishes: [],
    cart: { items: [], notes: '' },
    orders: [],
    updatedAt: 0,
    nickname: '',
    tab: 'menu',
    cat: '全部',
    keyword: '',
    orderFilter: 'all',
    detailId: '',
    editing: null,
    shareOpen: false,
    busy: false,
    joinCode: '',
    lastToken: ''
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(msg) {
    if (!toastEl) {
      return;
    }
    toastEl.textContent = msg;
    toastEl.className = 'toast';
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(function () {
      toastEl.className = 'toast hidden';
    }, 2200);
  }

  function lsGet(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (err) {
      return '';
    }
  }

  function lsSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {}
  }

  function tokenFromLocation() {
    var m = String(location.pathname || '').match(/^\/k\/([a-f0-9]{32})$/i);
    return m ? m[1].toLowerCase() : '';
  }

  function request(method, url, body) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      if (body) {
        xhr.setRequestHeader('Content-Type', 'application/json');
      }
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) {
          return;
        }
        var data;
        try {
          data = JSON.parse(xhr.responseText || '{}');
        } catch (err) {
          data = { ok: false, message: '服务器返回不正确' };
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          var error = new Error(data.message || '请求失败');
          error.data = data;
          reject(error);
        }
      };
      xhr.onerror = function () {
        reject(new Error('网络好像不太好，请稍后再试'));
      };
      xhr.send(body ? JSON.stringify(body) : null);
    });
  }

  function cartQty(id) {
    var items = (state.cart && state.cart.items) || [];
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        return items[i].quantity || 0;
      }
    }
    return 0;
  }

  function cartCount() {
    var items = (state.cart && state.cart.items) || [];
    var total = 0;
    var i;
    for (i = 0; i < items.length; i++) {
      total += items[i].quantity || 0;
    }
    return total;
  }

  function findDish(id) {
    var i;
    for (i = 0; i < state.dishes.length; i++) {
      if (state.dishes[i].id === id) {
        return state.dishes[i];
      }
    }
    return null;
  }

  function cartView() {
    var items = (state.cart && state.cart.items) || [];
    var result = [];
    var i, dish;
    for (i = 0; i < items.length; i++) {
      dish = findDish(items[i].id);
      if (dish && items[i].quantity) {
        result.push({
          id: dish.id,
          name: dish.name,
          emoji: dish.emoji,
          time: dish.time,
          difficulty: dish.difficulty,
          quantity: items[i].quantity
        });
      }
    }
    return result;
  }

  function applyPayload(data) {
    if (!data || data.unchanged) {
      return false;
    }
    state.token = data.token || state.token;
    state.code = data.code || state.code;
    state.shareUrl = data.shareUrl || state.shareUrl;
    state.updatedAt = data.updatedAt || 0;
    state.dishes = data.dishes || [];
    if (data.cart) {
      state.cart = {
        items: data.cart.items || [],
        notes: notesFocused ? ((state.cart && state.cart.notes) || '') : (data.cart.notes || '')
      };
    }
    state.orders = data.orders || [];
    return true;
  }

  function enterKitchen(data, replace) {
    applyPayload(data);
    state.ready = true;
    if (state.token) {
      lsSet(LS_TOKEN, state.token);
      var url = '/k/' + state.token;
      if (replace) {
        if (history.replaceState) {
          history.replaceState({ token: state.token }, '', url);
        } else {
          location.href = url;
        }
      } else if (location.pathname !== url && history.pushState) {
        history.pushState({ token: state.token }, '', url);
      }
    }
    startPoll();
    render();
  }

  function leaveToWelcome() {
    stopPoll();
    state.ready = false;
    state.token = '';
    state.lastToken = lsGet(LS_TOKEN);
    if (history.replaceState) {
      history.replaceState({}, '', '/');
    }
    render();
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function () {
      if (document.hidden || !state.token) {
        return;
      }
      refresh(true);
    }, POLL_MS);
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function refresh(silent) {
    if (!state.token) {
      return Promise.resolve();
    }
    var url = '/api/kitchens/' + encodeURIComponent(state.token);
    if (silent && state.updatedAt) {
      url += '?since=' + encodeURIComponent(String(state.updatedAt));
    }
    return request('GET', url).then(function (data) {
      if (applyPayload(data) && !state.editing) {
        render();
      }
    }).catch(function (err) {
      if (!silent) {
        showToast(err.message || '刷新失败');
      }
    });
  }

  function formatTime(ts) {
    if (!ts) {
      return '';
    }
    var date = new Date(ts);
    var y = date.getFullYear();
    var m = pad(date.getMonth() + 1);
    var d = pad(date.getDate());
    var hh = pad(date.getHours());
    var mm = pad(date.getMinutes());
    var nowDate = new Date();
    var today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
    var target = new Date(y, date.getMonth(), date.getDate()).getTime();
    var diff = Math.round((today - target) / 86400000);
    if (diff === 0) {
      return '今天 ' + hh + ':' + mm;
    }
    if (diff === 1) {
      return '昨天 ' + hh + ':' + mm;
    }
    if (y === nowDate.getFullYear()) {
      return m + '月' + d + '日 ' + hh + ':' + mm;
    }
    return y + '年' + m + '月' + d + '日 ' + hh + ':' + mm;
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function copyText(text, okMsg) {
    var done = function () {
      showToast(okMsg || '已复制');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallbackCopy(text, done);
      });
      return;
    }
    fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.focus();
    area.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {}
    document.body.removeChild(area);
    if (ok) {
      done();
    } else {
      showToast('复制失败，请长按自行复制');
    }
  }

  function filteredDishes() {
    var list = state.dishes || [];
    var keyword = (state.keyword || '').trim().toLowerCase();
    var result = [];
    var i, dish, hay;
    for (i = 0; i < list.length; i++) {
      dish = list[i];
      if (state.cat !== '全部' && dish.category !== state.cat) {
        continue;
      }
      if (keyword) {
        hay = [dish.name, dish.desc, dish.category, (dish.ingredients || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(keyword) === -1) {
          continue;
        }
      }
      result.push(dish);
    }
    return result;
  }

  function stepperHtml(id, qty) {
    var html = '<div class="stepper">';
    if (qty > 0) {
      html += '<button class="stepper-btn stepper-minus" type="button" data-act="minus" data-id="' + esc(id) + '">−</button>';
      html += '<span class="stepper-num">' + esc(qty) + '</span>';
    }
    html += '<button class="stepper-btn stepper-plus" type="button" data-act="plus" data-id="' + esc(id) + '">+</button>';
    html += '</div>';
    return html;
  }

  function dishCard(dish, withStepper) {
    var qty = cartQty(dish.id);
    var html = '<div class="card dish" data-act="detail" data-id="' + esc(dish.id) + '">';
    html += '<div class="dish-emoji">' + esc(dish.emoji || '🍽️') + '</div>';
    html += '<div class="dish-main">';
    html += '<div class="dish-name">' + esc(dish.name) + '</div>';
    html += '<div class="dish-desc">' + esc(dish.desc || '') + '</div>';
    html += '<div class="dish-meta"><span class="tag">' + esc(dish.difficulty || '') + '</span>⏱ ' + esc(dish.time) + ' 分钟</div>';
    html += '</div>';
    if (withStepper) {
      html += stepperHtml(dish.id, qty);
    }
    html += '</div>';
    return html;
  }

  function renderWelcome() {
    var nick = esc(state.nickname);
    var html = '<div class="welcome">';
    html += '<div class="logo-wrap">';
    html += '<div class="logo-mark"><img src="/icons/icon-192.png" alt="甜蜜厨房"></div>';
    html += '<div class="logo-name">甜蜜厨房</div>';
    html += '<div class="logo-sub">她点菜，他下厨</div>';
    html += '</div>';
    html += '<div class="card">';
    html += '<label class="field-label">昵称（可选）</label>';
    html += '<input class="input" id="nick-input" maxlength="12" placeholder="例如：我、她" value="' + nick + '">';
    html += '<p class="hero-sub mt-8">只保存在这台手机上，方便区分是谁在用。</p>';
    html += '</div>';
    html += '<div class="card">';
    html += '<div class="field-label">还没有厨房？</div>';
    html += '<button class="btn btn-primary" type="button" data-act="create"' + (state.busy ? ' disabled' : '') + '>创建厨房</button>';
    html += '</div>';
    html += '<div class="or-line">已经有邀请码？</div>';
    html += '<div class="card">';
    html += '<label class="field-label">输入 6 位邀请码</label>';
    html += '<input class="input code-input" id="code-input" maxlength="6" placeholder="例如 A3K7P2" value="' + esc(state.joinCode) + '">';
    html += '<button class="btn btn-ghost mt-12" type="button" data-act="join"' + (state.busy ? ' disabled' : '') + '>加入厨房</button>';
    html += '</div>';
    if (state.lastToken) {
      html += '<button class="btn btn-ghost mt-16" type="button" data-act="resume">回到上次的厨房</button>';
    }
    html += '</div>';
    appEl.innerHTML = html;
  }

  function renderHeader() {
    var title = '甜蜜厨房';
    if (state.nickname) {
      title += ' · ' + esc(state.nickname);
    }
    var html = '<header class="app-header">';
    html += '<h1>' + title + '</h1>';
    html += '<div class="header-actions">';
    html += '<button class="header-btn" type="button" data-act="share">分享厨房</button>';
    html += '</div></header>';
    return html;
  }

  function renderTabbar() {
    var count = cartCount();
    var tabs = [
      { id: 'menu', ico: '🍱', name: '菜单' },
      { id: 'cart', ico: '📝', name: '点菜单' },
      { id: 'orders', ico: '🧾', name: '订单' },
      { id: 'manage', ico: '📖', name: '菜谱' }
    ];
    var html = '<nav class="tabbar">';
    var i, t, badge;
    for (i = 0; i < tabs.length; i++) {
      t = tabs[i];
      badge = (t.id === 'cart' && count > 0) ? '<span class="tab-badge">' + (count > 99 ? '99+' : count) + '</span>' : '';
      html += '<button class="tab' + (state.tab === t.id ? ' on' : '') + '" type="button" data-act="tab" data-tab="' + t.id + '">';
      html += '<span class="ico">' + t.ico + '</span>' + t.name + badge + '</button>';
    }
    html += '</nav>';
    return html;
  }

  function renderMenu() {
    var html = '<div class="page">';
    html += '<div class="hero-title">今天想吃点什么呀 💕</div>';
    html += '<div class="hero-sub">点好啦，他就去下厨</div>';
    html += '<div class="search"><span>🔍</span><input id="search-input" placeholder="搜菜名、食材…" value="' + esc(state.keyword) + '"></div>';
    html += '<div class="cats">';
    var i;
    for (i = 0; i < CATEGORIES.length; i++) {
      html += '<button class="cat' + (state.cat === CATEGORIES[i] ? ' on' : '') + '" type="button" data-act="cat" data-cat="' + esc(CATEGORIES[i]) + '">' + esc(CATEGORIES[i]) + '</button>';
    }
    html += '</div>';
    var list = filteredDishes();
    if (!list.length) {
      html += '<div class="empty"><div class="empty-emoji">🪴</div><div class="empty-title">没找到这道菜</div><div class="empty-desc">换个词试试，或到「菜谱」里加一道新的</div></div>';
    } else {
      for (i = 0; i < list.length; i++) {
        html += dishCard(list[i], true);
      }
    }
    html += '</div>';
    return html;
  }

  function renderCart() {
    var items = cartView();
    var total = 0;
    var i;
    for (i = 0; i < items.length; i++) {
      total += items[i].quantity;
    }
    var html = '<div class="page' + (items.length ? ' has-footer' : '') + '">';
    if (!items.length) {
      html += '<div class="empty"><div class="empty-emoji">🧺</div><div class="empty-title">还没点菜哦</div><div class="empty-desc">先去菜单里逛逛，挑几道想吃的</div>';
      html += '<button class="btn btn-primary mt-16" type="button" data-act="tab" data-tab="menu">去菜单看看</button></div>';
    } else {
      html += '<div class="hero-title">这些都是要点的 🍱</div>';
      html += '<div class="hero-sub">有忌口或偏好，写在下面告诉他</div>';
      for (i = 0; i < items.length; i++) {
        html += dishCard(items[i], true);
      }
      html += '<div class="card mt-12"><label class="field-label">整单备注</label>';
      html += '<textarea class="textarea" id="notes-input" maxlength="120" placeholder="例如：少辣、多放蒜、不要香菜～">' + esc((state.cart && state.cart.notes) || '') + '</textarea></div>';
      html += '<button class="muted-link" type="button" data-act="clear-cart">清空点菜单</button>';
      html += '</div>';
      html += '<div class="footer-bar"><div class="footer-info"><div class="footer-count">共 ' + items.length + ' 道 · ' + total + ' 份</div>';
      html += '<div class="footer-hint">提交后对方就能在订单里看到</div></div>';
      html += '<button class="btn btn-primary" type="button" data-act="submit"' + (state.busy ? ' disabled' : '') + '>交给厨房</button></div>';
    }
    html += '';
    return html;
  }

  function renderOrders() {
    var html = '<div class="page">';
    var pending = 0;
    var i, j, order, portions;
    for (i = 0; i < state.orders.length; i++) {
      if (state.orders[i].status !== 'done') {
        pending += 1;
      }
    }
    html += '<div class="hero-title">厨房进度 👨‍🍳</div>';
    html += '<div class="hero-sub">' + (pending ? ('还有 ' + pending + ' 笔在做，做好可以点一下') : '暂时没有待做的订单') + '</div>';
    html += '<div class="filters">';
    html += '<button class="filter' + (state.orderFilter === 'all' ? ' on' : '') + '" type="button" data-act="order-filter" data-filter="all">全部</button>';
    html += '<button class="filter' + (state.orderFilter === 'pending' ? ' on' : '') + '" type="button" data-act="order-filter" data-filter="pending">待做</button>';
    html += '<button class="filter' + (state.orderFilter === 'done' ? ' on' : '') + '" type="button" data-act="order-filter" data-filter="done">做好啦</button>';
    html += '</div>';

    var shown = 0;
    for (i = 0; i < state.orders.length; i++) {
      order = state.orders[i];
      if (state.orderFilter === 'pending' && order.status === 'done') {
        continue;
      }
      if (state.orderFilter === 'done' && order.status !== 'done') {
        continue;
      }
      shown += 1;
      portions = 0;
      for (j = 0; j < (order.items || []).length; j++) {
        portions += order.items[j].quantity || 0;
      }
      html += '<div class="card">';
      html += '<div class="order-head"><span class="order-time">' + esc(formatTime(order.createdAt)) + '</span>';
      html += '<span class="tag ' + (order.status === 'done' ? 'tag-done' : 'tag-pending') + '">' + (order.status === 'done' ? '做好啦' : '待做') + '</span></div>';
      html += '<div class="order-items">';
      for (j = 0; j < (order.items || []).length; j++) {
        html += '<div class="order-item"><span class="em">' + esc(order.items[j].emoji) + '</span><span class="nm">' + esc(order.items[j].name) + '</span><span class="qt">×' + esc(order.items[j].quantity) + '</span></div>';
      }
      html += '</div>';
      if (order.notes) {
        html += '<div class="order-notes">备注：' + esc(order.notes) + '</div>';
      }
      html += '<div class="order-foot"><span class="order-sum">' + (order.items || []).length + ' 道 · ' + portions + ' 份</span><span>';
      html += '<button class="mini ghost" type="button" data-act="del-order" data-id="' + esc(order.id) + '">删除</button>';
      if (order.status !== 'done') {
        html += '<button class="mini primary" type="button" data-act="done-order" data-id="' + esc(order.id) + '">做好啦</button>';
      }
      html += '</span></div></div>';
    }
    if (!state.orders.length) {
      html += '<div class="empty"><div class="empty-emoji">💌</div><div class="empty-title">还没有订单</div><div class="empty-desc">去菜单里点几道爱吃的，提交后会出现在这里</div>';
      html += '<button class="btn btn-primary mt-16" type="button" data-act="tab" data-tab="menu">去点菜</button></div>';
    } else if (!shown) {
      html += '<div class="empty"><div class="empty-emoji">🌸</div><div class="empty-title">这一栏是空的</div><div class="empty-desc">换个筛选看看吧</div></div>';
    }
    html += '</div>';
    return html;
  }

  function renderManage() {
    var html = '<div class="page has-footer">';
    html += '<div class="hero-title">我们的菜谱本 📖</div>';
    html += '<div class="hero-sub">改动会同步到你们的厨房</div>';
    html += '<div class="card kitchen-card">';
    html += '<div class="field-label">厨房邀请码</div>';
    html += '<div class="code">' + esc(state.code) + '</div>';
    html += '<button class="btn btn-ghost" type="button" data-act="copy-code">复制邀请码</button>';
    html += '<button class="btn btn-primary mt-8" type="button" data-act="copy-link">复制厨房链接</button>';
    html += '<p class="hero-sub mt-8">把链接或邀请码发给另一半，对方打开即可一起点菜。</p>';
    html += '</div>';
    var i, dish;
    if (!state.dishes.length) {
      html += '<div class="empty"><div class="empty-emoji">📝</div><div class="empty-title">还没有菜谱</div><div class="empty-desc">先加一道菜，或恢复自带的家常菜</div>';
      html += '<button class="btn btn-ghost mt-16" type="button" data-act="restore">恢复默认菜谱</button></div>';
    }
    for (i = 0; i < state.dishes.length; i++) {
      dish = state.dishes[i];
      html += '<div class="card row" data-act="detail" data-id="' + esc(dish.id) + '">';
      html += '<div class="dish-emoji">' + esc(dish.emoji || '🍽️') + '</div>';
      html += '<div class="dish-main"><div class="dish-name">' + esc(dish.name) + '</div>';
      html += '<div class="dish-desc">' + esc(dish.category) + ' · ' + esc(dish.difficulty) + ' · ' + esc(dish.time) + ' 分钟</div></div>';
      html += '<div class="row-actions">';
      html += '<button class="link" type="button" data-act="edit" data-id="' + esc(dish.id) + '">编辑</button>';
      html += '<button class="link muted" type="button" data-act="del-dish" data-id="' + esc(dish.id) + '" data-name="' + esc(dish.name) + '">删除</button>';
      html += '</div></div>';
    }
    if (state.dishes.length) {
      html += '<button class="muted-link" type="button" data-act="restore">恢复默认菜谱</button>';
    }
    html += '</div>';
    html += '<div class="footer-bar"><button class="btn btn-primary" type="button" data-act="edit-new">＋ 新增菜谱</button></div>';
    return html;
  }

  function renderDetail() {
    var dish = findDish(state.detailId);
    if (!dish) {
      return '';
    }
    var qty = cartQty(dish.id);
    var html = '<div class="overlay" id="overlay-detail">';
    html += '<div class="overlay-bar"><button type="button" data-act="close-detail">返回</button><h2>菜谱详情</h2><button type="button" data-act="edit" data-id="' + esc(dish.id) + '">编辑</button></div>';
    html += '<div class="page has-footer">';
    html += '<div class="card head-center"><div class="head-emoji">' + esc(dish.emoji) + '</div>';
    html += '<div class="hero-title">' + esc(dish.name) + '</div>';
    html += '<p class="hero-sub">' + esc(dish.desc || '') + '</p>';
    html += '<div class="mt-12"><span class="tag">' + esc(dish.category) + '</span> <span class="tag">' + esc(dish.difficulty) + '</span> <span class="tag">⏱ ' + esc(dish.time) + ' 分钟</span></div></div>';
    html += '<div class="card"><div class="section-title">食材</div>';
    var i;
    if (!dish.ingredients || !dish.ingredients.length) {
      html += '<div class="hero-sub">还没有填写食材</div>';
    }
    for (i = 0; i < (dish.ingredients || []).length; i++) {
      html += '<div class="ing"><span class="dot">♡</span><span>' + esc(dish.ingredients[i]) + '</span></div>';
    }
    html += '</div>';
    html += '<div class="card"><div class="section-title">步骤</div>';
    if (!dish.steps || !dish.steps.length) {
      html += '<div class="hero-sub">还没有填写步骤</div>';
    }
    for (i = 0; i < (dish.steps || []).length; i++) {
      html += '<div class="step-row"><span class="step-no">' + (i + 1) + '</span><span class="step-text">' + esc(dish.steps[i]) + '</span></div>';
    }
    html += '</div></div>';
    html += '<div class="footer-bar">' + stepperHtml(dish.id, qty);
    html += '<button class="btn btn-primary" type="button" data-act="plus" data-id="' + esc(dish.id) + '">' + (qty > 0 ? '再加一份' : '加入点菜单') + '</button></div>';
    html += '</div>';
    return html;
  }

  function renderEdit() {
    var dish = state.editing;
    if (!dish) {
      return '';
    }
    var isNew = !findDish(dish.id);
    var html = '<div class="overlay" id="overlay-edit">';
    html += '<div class="overlay-bar"><button type="button" data-act="close-edit">取消</button><h2>' + (isNew ? '新增菜谱' : '编辑菜谱') + '</h2><span></span></div>';
    html += '<div class="page form-page has-footer">';
    html += '<div class="card">';
    html += '<div class="field"><label class="field-label">菜名</label><input class="input" id="edit-name" maxlength="20" placeholder="例如：番茄炒蛋" value="' + esc(dish.name || '') + '"></div>';
    html += '<div class="row-2"><div class="field"><label class="field-label">表情</label><input class="input" id="edit-emoji" maxlength="4" placeholder="🍅" value="' + esc(dish.emoji || '🍽️') + '"></div>';
    html += '<div class="field"><label class="field-label">分类</label><select class="input picker" id="edit-category">';
    var i;
    for (i = 0; i < DISH_CATEGORIES.length; i++) {
      html += '<option value="' + esc(DISH_CATEGORIES[i]) + '"' + (dish.category === DISH_CATEGORIES[i] ? ' selected' : '') + '>' + esc(DISH_CATEGORIES[i]) + '</option>';
    }
    html += '</select></div></div>';
    html += '<div class="field"><label class="field-label">一句话介绍</label><input class="input" id="edit-desc" maxlength="40" placeholder="例如：经典家常，酸甜开胃" value="' + esc(dish.desc || '') + '"></div>';
    html += '<div class="row-2"><div class="field"><label class="field-label">难度</label><select class="input picker" id="edit-difficulty">';
    for (i = 0; i < DIFFICULTIES.length; i++) {
      html += '<option value="' + esc(DIFFICULTIES[i]) + '"' + (dish.difficulty === DIFFICULTIES[i] ? ' selected' : '') + '>' + esc(DIFFICULTIES[i]) + '</option>';
    }
    html += '</select></div>';
    html += '<div class="field"><label class="field-label">烹饪时间（分钟）</label><input class="input" id="edit-time" type="number" placeholder="20" value="' + esc(dish.time || 20) + '"></div></div>';
    html += '</div>';
    html += '<div class="card"><div class="field"><label class="field-label">食材（一行一项）</label>';
    html += '<textarea class="textarea" id="edit-ingredients" placeholder="番茄 2 个&#10;鸡蛋 3 个">' + esc((dish.ingredients || []).join('\n')) + '</textarea></div></div>';
    html += '<div class="card"><div class="field"><label class="field-label">步骤（一行一步）</label>';
    html += '<textarea class="textarea" id="edit-steps" placeholder="鸡蛋打散……">' + esc((dish.steps || []).join('\n')) + '</textarea></div></div>';
    html += '</div>';
    html += '<div class="footer-bar"><button class="btn btn-primary" type="button" data-act="save-dish"' + (state.busy ? ' disabled' : '') + '>保存菜谱</button></div>';
    html += '</div>';
    return html;
  }

  function renderShare() {
    if (!state.shareOpen) {
      return '';
    }
    var html = '<div class="overlay" id="overlay-share">';
    html += '<div class="overlay-bar"><button type="button" data-act="close-share">关闭</button><h2>分享厨房</h2><span></span></div>';
    html += '<div class="page">';
    html += '<div class="card kitchen-card"><div class="field-label">口头邀请码</div>';
    html += '<div class="code">' + esc(state.code) + '</div>';
    html += '<button class="btn btn-ghost" type="button" data-act="copy-code">复制邀请码</button></div>';
    html += '<div class="card"><div class="field-label">厨房链接（打开即加入，不用再输码）</div>';
    html += '<div class="share-box">' + esc(state.shareUrl || (location.origin + '/k/' + state.token)) + '</div>';
    html += '<button class="btn btn-primary" type="button" data-act="copy-link">复制链接</button>';
    html += '<p class="hero-sub mt-8">把链接发给另一半，用微信或浏览器打开即可。</p></div>';
    html += '</div></div>';
    return html;
  }

  function renderApp() {
    var html = '<div class="app-shell">';
    html += renderHeader();
    if (state.tab === 'menu') {
      html += renderMenu();
    } else if (state.tab === 'cart') {
      html += renderCart();
    } else if (state.tab === 'orders') {
      html += renderOrders();
    } else {
      html += renderManage();
    }
    html += renderTabbar();
    html += '</div>';
    if (state.detailId) {
      html += renderDetail();
    }
    if (state.editing) {
      html += renderEdit();
    }
    html += renderShare();
    appEl.innerHTML = html;
    bindSpecial();
  }

  function bindSpecial() {
    var search = $('search-input');
    if (search) {
      if (!window._searchTimer) {
        window._searchTimer = null;
      }
      search.addEventListener('input', function () {
        state.keyword = search.value;
        if (window._searchTimer) {
          clearTimeout(window._searchTimer);
        }
        window._searchTimer = setTimeout(function () {
          var pos = 0;
          var el = $('search-input');
          if (el && el.selectionStart != null) {
            pos = el.selectionStart;
          }
          render();
          el = $('search-input');
          if (el) {
            el.focus();
            if (el.setSelectionRange) {
              el.setSelectionRange(pos, pos);
            }
          }
        }, 180);
      });
    }
    var notes = $('notes-input');
    if (notes) {
      notes.addEventListener('focus', function () {
        notesFocused = true;
      });
      notes.addEventListener('blur', function () {
        notesFocused = false;
        saveNotes(notes.value);
      });
      notes.addEventListener('input', function () {
        state.cart.notes = notes.value;
      });
    }
    var nick = $('nick-input');
    if (nick) {
      nick.addEventListener('input', function () {
        state.nickname = nick.value.trim();
        lsSet(LS_NICK, state.nickname);
      });
    }
    var code = $('code-input');
    if (code) {
      code.addEventListener('input', function () {
        state.joinCode = String(code.value || '').toUpperCase();
      });
    }
  }

  function render() {
    if (!state.ready) {
      renderWelcome();
    } else {
      renderApp();
    }
  }

  function rememberNickFromWelcome() {
    var nick = $('nick-input');
    if (nick) {
      state.nickname = String(nick.value || '').trim().slice(0, 12);
      lsSet(LS_NICK, state.nickname);
    }
  }

  function createKitchen() {
    if (state.busy) {
      return;
    }
    rememberNickFromWelcome();
    state.busy = true;
    render();
    request('POST', '/api/kitchens', {}).then(function (data) {
      state.busy = false;
      enterKitchen(data, true);
      state.shareOpen = true;
      render();
      showToast('厨房已创建，把链接发给另一半吧');
    }).catch(function (err) {
      state.busy = false;
      render();
      showToast(err.message || '创建失败');
    });
  }

  function joinKitchen(code) {
    if (state.busy) {
      return;
    }
    rememberNickFromWelcome();
    var value = String(code || state.joinCode || '').trim();
    if (!value) {
      var input = $('code-input');
      if (input) {
        value = input.value;
      }
    }
    if (!value || value.replace(/\s+/g, '').length !== 6) {
      showToast('请输入 6 位邀请码');
      return;
    }
    state.busy = true;
    render();
    request('POST', '/api/kitchens/join', { code: value }).then(function (data) {
      state.busy = false;
      enterKitchen(data, true);
      showToast('已加入厨房');
    }).catch(function (err) {
      state.busy = false;
      render();
      showToast(err.message || '加入失败');
    });
  }

  function loadKitchen(token, replace) {
    return request('GET', '/api/kitchens/' + encodeURIComponent(token)).then(function (data) {
      enterKitchen(data, replace);
    });
  }

  function changeQty(id, delta) {
    if (!state.token) {
      return;
    }
    /* 乐观更新 */
    var items = ((state.cart && state.cart.items) || []).slice();
    var found = false;
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        found = true;
        items[i] = { id: items[i].id, quantity: items[i].quantity + delta };
        if (items[i].quantity <= 0) {
          items.splice(i, 1);
        }
        break;
      }
    }
    if (!found && delta > 0) {
      items.push({ id: id, quantity: delta });
    }
    state.cart.items = items;
    render();
    request('POST', '/api/kitchens/' + encodeURIComponent(state.token) + '/cart', {
      action: 'change',
      id: id,
      delta: delta
    }).then(function (data) {
      applyPayload(data);
      render();
    }).catch(function (err) {
      refresh(false);
      showToast(err.message || '同步失败');
    });
  }

  var notesTimer = null;
  function saveNotes(notes) {
    if (!state.token) {
      return;
    }
    state.cart.notes = notes;
    if (notesTimer) {
      clearTimeout(notesTimer);
    }
    notesTimer = setTimeout(function () {
      request('POST', '/api/kitchens/' + encodeURIComponent(state.token) + '/cart', {
        action: 'notes',
        notes: notes
      }).then(function (data) {
        applyPayload(data);
      }).catch(function (err) {
        showToast(err.message || '备注同步失败');
      });
    }, 400);
  }

  function confirmModal(title, okFn) {
    if (window.confirm(title)) {
      okFn();
    }
  }

  function collectEdit() {
    function val(id) {
      var el = $(id);
      return el ? el.value : '';
    }
    function lines(id) {
      return String(val(id) || '').split(/\r?\n/).map(function (s) {
        return s.trim();
      }).filter(Boolean);
    }
    return {
      id: state.editing && state.editing.id ? state.editing.id : 'dish-' + Date.now(),
      name: val('edit-name'),
      emoji: val('edit-emoji'),
      category: val('edit-category'),
      desc: val('edit-desc'),
      difficulty: val('edit-difficulty'),
      time: parseInt(val('edit-time'), 10),
      ingredients: lines('edit-ingredients'),
      steps: lines('edit-steps')
    };
  }

  function onClick(e) {
    var target = e.target;
    var act = '';
    var el = target;
    while (el && el !== appEl) {
      if (el.getAttribute && el.getAttribute('data-act')) {
        act = el.getAttribute('data-act');
        break;
      }
      el = el.parentNode;
    }
    if (!act) {
      return;
    }
    var id = el.getAttribute('data-id') || '';
    if (act === 'plus' || act === 'minus') {
      e.preventDefault();
      e.stopPropagation();
      changeQty(id, act === 'plus' ? 1 : -1);
      return;
    }
    if (act === 'create') {
      createKitchen();
      return;
    }
    if (act === 'join') {
      joinKitchen();
      return;
    }
    if (act === 'resume') {
      if (state.lastToken) {
        loadKitchen(state.lastToken, true).catch(function (err) {
          showToast(err.message || '无法进入上次的厨房');
        });
      }
      return;
    }
    if (act === 'tab') {
      state.tab = el.getAttribute('data-tab') || 'menu';
      state.detailId = '';
      render();
      return;
    }
    if (act === 'cat') {
      state.cat = el.getAttribute('data-cat') || '全部';
      render();
      return;
    }
    if (act === 'detail') {
      state.detailId = id;
      render();
      return;
    }
    if (act === 'close-detail') {
      state.detailId = '';
      render();
      return;
    }
    if (act === 'share' || act === 'close-share') {
      state.shareOpen = act === 'share';
      render();
      return;
    }
    if (act === 'copy-code') {
      copyText(state.code, '邀请码已复制');
      return;
    }
    if (act === 'copy-link') {
      copyText(state.shareUrl || (location.origin + '/k/' + state.token), '链接已复制');
      return;
    }
    if (act === 'clear-cart') {
      confirmModal('要把已经点的菜都去掉吗？', function () {
        request('POST', '/api/kitchens/' + encodeURIComponent(state.token) + '/cart', { action: 'clear' }).then(function (data) {
          applyPayload(data);
          render();
        }).catch(function (err) {
          showToast(err.message || '清空失败');
        });
      });
      return;
    }
    if (act === 'submit') {
      confirmModal('把点菜单交给厨房去做？', function () {
        var notesEl = $('notes-input');
        var notes = notesEl ? notesEl.value : (state.cart && state.cart.notes) || '';
        state.busy = true;
        render();
        request('POST', '/api/kitchens/' + encodeURIComponent(state.token) + '/orders', { notes: notes }).then(function (data) {
          state.busy = false;
          applyPayload(data);
          state.tab = 'orders';
          render();
          showToast('已告诉厨房啦');
        }).catch(function (err) {
          state.busy = false;
          render();
          showToast(err.message || '提交失败');
        });
      });
      return;
    }
    if (act === 'order-filter') {
      state.orderFilter = el.getAttribute('data-filter') || 'all';
      render();
      return;
    }
    if (act === 'done-order') {
      confirmModal('标记为做好啦？', function () {
        request('POST', '/api/kitchens/' + encodeURIComponent(state.token) + '/orders/' + encodeURIComponent(id), { action: 'done' }).then(function (data) {
          applyPayload(data);
          render();
          showToast('可以开吃了');
        }).catch(function (err) {
          showToast(err.message || '更新失败');
        });
      });
      return;
    }
    if (act === 'del-order') {
      confirmModal('删除这笔订单？删除后不能恢复。', function () {
        request('DELETE', '/api/kitchens/' + encodeURIComponent(state.token) + '/orders/' + encodeURIComponent(id)).then(function (data) {
          applyPayload(data);
          render();
        }).catch(function (err) {
          showToast(err.message || '删除失败');
        });
      });
      return;
    }
    if (act === 'edit' || act === 'edit-new') {
      if (act === 'edit-new') {
        state.editing = {
          id: 'dish-' + Date.now(),
          name: '',
          emoji: '🍽️',
          category: '家常菜',
          desc: '',
          difficulty: '简单',
          time: 20,
          ingredients: [],
          steps: []
        };
      } else {
        state.editing = findDish(id) || { id: id };
      }
      render();
      return;
    }
    if (act === 'close-edit') {
      state.editing = null;
      render();
      return;
    }
    if (act === 'save-dish') {
      var dish = collectEdit();
      if (!String(dish.name || '').trim()) {
        showToast('先写一下菜名哦');
        return;
      }
      if (!dish.time || dish.time <= 0) {
        showToast('请填写烹饪时间（分钟）');
        return;
      }
      state.busy = true;
      render();
      /* render 会重绘表单，先把值写回 editing 避免丢失：collect 已经拿到了 */
      state.editing = dish;
      request('POST', '/api/kitchens/' + encodeURIComponent(state.token) + '/dishes', dish).then(function (data) {
        state.busy = false;
        applyPayload(data);
        state.editing = null;
        render();
        showToast('已保存');
      }).catch(function (err) {
        state.busy = false;
        render();
        showToast(err.message || '保存失败');
      });
      return;
    }
    if (act === 'del-dish') {
      var name = el.getAttribute('data-name') || '这道菜';
      confirmModal('确定删除「' + name + '」吗？点菜单里的这份也会一起去掉。', function () {
        request('DELETE', '/api/kitchens/' + encodeURIComponent(state.token) + '/dishes/' + encodeURIComponent(id)).then(function (data) {
          applyPayload(data);
          if (state.detailId === id) {
            state.detailId = '';
          }
          render();
          showToast('已删除');
        }).catch(function (err) {
          showToast(err.message || '删除失败');
        });
      });
      return;
    }
    if (act === 'restore') {
      confirmModal('会用自带的 21 道家常菜覆盖当前全部菜谱，自己改过或新增的内容会丢失。确定恢复吗？', function () {
        request('POST', '/api/kitchens/' + encodeURIComponent(state.token) + '/dishes/restore', {}).then(function (data) {
          applyPayload(data);
          render();
          showToast('已恢复默认菜谱');
        }).catch(function (err) {
          showToast(err.message || '恢复失败');
        });
      });
    }
  }

  function onPopState() {
    var token = tokenFromLocation();
    if (token) {
      loadKitchen(token, true).catch(function (err) {
        showToast(err.message || '无法打开这个厨房');
        leaveToWelcome();
      });
    } else {
      leaveToWelcome();
    }
  }

  function init() {
    state.nickname = lsGet(LS_NICK);
    state.lastToken = lsGet(LS_TOKEN);
    appEl.addEventListener('click', onClick);
    window.addEventListener('popstate', onPopState);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.token) {
        refresh(true);
      }
    });

    var token = tokenFromLocation();
    if (token) {
      loadKitchen(token, true).catch(function (err) {
        showToast(err.message || '无法打开这个厨房');
        state.lastToken = lsGet(LS_TOKEN);
        renderWelcome();
      });
      return;
    }
    renderWelcome();
  }

  init();
})();
