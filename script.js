// Wholesale Market – front-end demo. Data lives in this browser's localStorage only.
// Needs i18n.js (translations, t(), tp()) to be loaded first.
const PRICE = 100;      // default price per unit (wholesalers can set their own per product)
const MAX_PRICE = 1000000;
const priceOf = (p) => (typeof p.price === 'number' ? p.price : PRICE);
const parsePrice = (v) => {
  const n = Math.round(parseFloat(v) * 100) / 100;
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE ? n : null;
};
const lineTotal = (price, qty) => Math.round(price * qty * 100) / 100;
const MAX_QTY = 20;     // max units a customer can buy of one product in one order
const MAX_STOCK = 1000000;  // max units a wholesaler can list per product
const MAX_PHOTOS = 3;
const parseQty = (v, min) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= MAX_STOCK ? n : null;
};
const CATEGORIES = ['Toys', 'Electronics', 'Fashion', 'Beauty', 'Other'];   // stored in English, shown translated
const STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered'];          // stored in English, shown translated
const KEY = { users: 'ws_users', products: 'ws_products', orders: 'ws_orders', reviews: 'ws_reviews', messages: 'ws_messages', session: 'ws_session', theme: 'ws_theme', lang: 'ws_lang' };

const $ = (id) => document.getElementById(id);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const te = (key, vars) => esc(t(key, vars));   // translated text that is safe to put inside innerHTML
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const money = (n) => n.toLocaleString();
const rs = (n) => `Rs ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;   // Indian Rupees
const categoryOf = (p) => (CATEGORIES.includes(p.category) ? p.category : 'Other');
const catLabel = (c) => t(`cat.${CATEGORIES.includes(c) ? c : 'Other'}`);
const statusLabel = (s) => t(`status.${s}`);
const productImages = (p) => p.images || (p.image ? [p.image] : []);   // older products stored one `image`
const orderCode = (o) => String(o.id).slice(-6).toUpperCase();
const sumTotal = (items) => Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100;
const unitsOf = (o) => o.items.reduce((s, i) => s + i.qty, 0);
const getProducts = () => load(KEY.products, []);
const getOrders = () => load(KEY.orders, []);
const getUsers = () => load(KEY.users, []);
const locale = () => (currentLang === 'hi' ? 'hi-IN' : 'en-IN');
const fmtDate = (ts) => new Date(ts).toLocaleString(locale());
const fmtDay = (ts) => new Date(ts).toLocaleDateString(locale());

function msgTo(id, text, kind) { const el = $(id); el.textContent = text; el.className = 'form-msg' + (kind ? ' ' + kind : ''); }

// ---------- Theme (dark / light) ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('theme-btn');
  btn.textContent = theme === 'light' ? '🌙' : '☀️';
  btn.setAttribute('aria-label', t(theme === 'light' ? 'aria.theme.dark' : 'aria.theme.light'));
  document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f8f5ff' : '#0f0818';
}
$('theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem(KEY.theme, next); } catch { /* storage unavailable: theme just won't persist */ }
  applyTheme(next);
});

// ---------- Language (English is the default, Hindi optional) ----------
// Static text carries data-i18n / data-i18n-html / data-i18n-ph / data-i18n-aria / data-i18n-title attributes;
// text built in JavaScript calls t() directly and is redrawn by refreshView().
function applyStaticText() {
  document.documentElement.lang = currentLang;
  document.title = t('meta.title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  [['detail-dialog', 'detail.title'], ['cart-dialog', 'cart.title'], ['edit-dialog', 'edit.title'], ['receipt-dialog', 'rc.title']]
    .forEach(([id, key]) => $(id).setAttribute('aria-label', t(key)));
  $('foot-copy').textContent = t('foot.copy', { year: new Date().getFullYear() });
  $('lang-select').value = currentLang;
}

function fillCatSelects() {
  document.querySelectorAll('.cat-select').forEach((s) => {
    const prev = s.value;
    s.innerHTML = CATEGORIES.map((c) => `<option value="${c}">${te(`cat.${c}`)}</option>`).join('');
    if (prev) s.value = prev;
  });
}

function fillSubjectSelect() {
  const sel = $('contact-subject');
  const prev = sel.value;
  sel.innerHTML = ['order', 'product', 'account', 'feedback', 'other'].map((k) => `<option value="${k}">${te(`contact.s.${k}`)}</option>`).join('');
  if (prev) sel.value = prev;
}

function setLang(lang, persist = true) {
  currentLang = I18N[lang] ? lang : 'en';
  if (persist) { try { localStorage.setItem(KEY.lang, currentLang); } catch { /* ignore */ } }
  applyStaticText();
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  fillCatSelects();
  fillSubjectSelect();
  document.querySelectorAll('.form-msg').forEach((el) => { el.textContent = ''; el.className = 'form-msg'; });   // old messages would stay in the old language
  setMode(mode);
  updateChannelText();
  renderOtpTexts();
  renderResendBtn();
  refreshView();
}
$('lang-select').addEventListener('change', (e) => setLang(e.target.value));

// ---------- Seed demo data + migrations ----------
function seed() {
  if (!load(KEY.users, null)) {
    save(KEY.users, [
      { id: 'u1', role: 'wholesaler', name: 'Demo Wholesaler', store: 'Happy Toys Store', email: 'wholesaler@demo.com', mobile: '9000000001', password: 'demo123' },
      { id: 'u2', role: 'customer', name: 'Demo Customer', email: 'customer@demo.com', mobile: '9000000002', password: 'demo123' },
    ]);
    const now = Date.now();
    save(KEY.products, [
      { id: 'p1', ownerId: 'u1', name: 'Toys', store: 'Happy Toys Store', category: 'Toys', description: 'Soft, safe and cuddly toys for kids of all ages.', qty: 20, emoji: '🧸', images: [], created: now },
      { id: 'p2', ownerId: 'u1', name: 'Building Blocks', store: 'Happy Toys Store', category: 'Toys', description: 'Colourful interlocking blocks that build creativity.', qty: 12, emoji: '🧱', images: [], created: now - 1 },
      { id: 'p3', ownerId: 'u1', name: 'Toy Cars', store: 'Happy Toys Store', category: 'Toys', description: 'Pull-back toy cars in assorted colours.', qty: 8, emoji: '🚗', images: [], created: now - 2 },
    ]);
    save(KEY.orders, []);
  }
  migrate();
}

// Brings data saved by older versions of the site up to date
function migrate() {
  const users = getUsers();
  const demoMobiles = { 'wholesaler@demo.com': '9000000001', 'customer@demo.com': '9000000002' };
  let changed = false;
  users.forEach((u) => { if (!u.mobile && demoMobiles[u.email]) { u.mobile = demoMobiles[u.email]; changed = true; } });
  if (changed) save(KEY.users, users);

  const products = getProducts();
  changed = false;
  products.forEach((p) => {
    if (!p.category) { p.category = ['p1', 'p2', 'p3'].includes(p.id) ? 'Toys' : 'Other'; changed = true; }
  });
  if (changed) save(KEY.products, products);

  const orders = getOrders();
  changed = false;
  orders.forEach((o) => {
    if (!o.items) {   // old single-item order
      o.items = [{ productId: null, name: o.name, store: o.store, price: o.qty ? o.total / o.qty : 0, qty: o.qty, total: o.total }];
      changed = true;
    }
    if (!o.status) { o.status = 'Pending'; changed = true; }
  });
  if (changed) save(KEY.orders, orders);
}

// ---------- Session / routing ----------
// The login lives in sessionStorage, which is separate for every browser tab. (localStorage is shared by all
// tabs, so logging in as a wholesaler in one tab used to switch a customer tab to that account too.)
const getSession = () => { try { return sessionStorage.getItem(KEY.session); } catch { return null; } };
const setSession = (id) => { try { sessionStorage.setItem(KEY.session, id); } catch { /* storage unavailable */ } };
const clearSession = () => { try { sessionStorage.removeItem(KEY.session); } catch { /* ignore */ } };
const currentUser = () => getUsers().find((u) => u.id === getSession()) || null;
let page = 'home';   // 'home' (landing or role dashboard), 'profile' or 'help'

function show(view) {
  ['auth-view', 'wholesaler-view', 'customer-view', 'profile-view', 'help-view'].forEach((v) => ($(v).hidden = v !== view));
}

function renderChip(user) {
  $('user-chip').textContent = user.role === 'wholesaler' ? `🏢 ${user.store || user.name}` : `🛒 ${user.name}`;
}

function renderNavLabels() {
  $('help-btn').textContent = t(page === 'help' ? 'btn.back' : 'btn.help');
  $('profile-btn').textContent = t(page === 'profile' ? 'btn.back' : 'btn.profile');
}

function route() {
  const user = currentUser();
  $('nav-right').hidden = !user;
  $('nav-links').hidden = !!user;
  renderNavLabels();
  if (user) { renderChip(user); $('cart-btn').hidden = user.role !== 'customer'; }

  if (page === 'help') { show('help-view'); renderHelp(user); window.scrollTo(0, 0); return; }
  if (!user) { page = 'home'; show('auth-view'); renderNavLabels(); return; }
  if (page === 'profile') { show('profile-view'); renderProfile(user); }
  else if (user.role === 'wholesaler') { show('wholesaler-view'); renderWholesaler(user); }
  else { show('customer-view'); renderCustomer(user); }
  window.scrollTo(0, 0);
}

// Redraws what is on screen (without jumping to the top or resetting forms): used after a language change
// and when another tab changes shared data
function refreshView() {
  const user = currentUser();
  renderNavLabels();
  if (user) renderChip(user);
  if (page === 'help') renderHelp(user);
  else if (user && page === 'home') {
    if (user.role === 'wholesaler') renderWholesaler(user); else renderCustomer(user);
  }
  if ($('detail-dialog').open && detailId) renderDetail(detailId);
  if ($('cart-dialog').open && user) renderCart();
  if ($('receipt-dialog').open && receiptId) openReceipt(receiptId);
  if ($('edit-dialog').open && editState) renderEditPhotos();
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  // A modal <dialog> sits in the browser's top layer above everything, so show the toast inside it
  (document.querySelector('dialog[open]') || document.body).appendChild(el);
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Search: case-insensitive, ignores plural "s" (toys ⇄ toy), every typed word must match name, store or category
const stem = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const normText = (s) => s.toLowerCase().split(/\s+/).filter(Boolean).map(stem).join(' ');
function matchesSearch(p, query) {
  const words = normText(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = normText(`${p.name} ${p.store} ${categoryOf(p)} ${catLabel(categoryOf(p))}`);
  return words.every((w) => hay.includes(w));
}

function qtyOptions(max, selected) {
  let html = '';
  for (let i = 1; i <= max; i++) html += `<option value="${i}"${i === selected ? ' selected' : ''}>${i}</option>`;
  return html;
}

// ---------- Wishlist & cart (stored per user) ----------
const userKey = (prefix) => `${prefix}_${getSession() || ''}`;
const getWish = () => load(userKey('ws_wish'), []);
const isWished = (id) => getWish().includes(id);
function toggleWish(id) {
  const w = getWish();
  const i = w.indexOf(id);
  if (i >= 0) w.splice(i, 1); else w.push(id);
  save(userKey('ws_wish'), w);
  return i < 0;
}

const getCart = () => load(userKey('ws_cart'), []);
const setCart = (c) => save(userKey('ws_cart'), c);
function updateCartCount() {
  const n = getCart().reduce((s, l) => s + l.qty, 0);
  $('cart-count').textContent = n;
  $('cart-count').hidden = !n;
}

// Cart lines resolved against current stock; deleted / sold-out products drop out
function cartLines() {
  const products = getProducts();
  return getCart().map((l) => {
    const p = products.find((x) => x.id === l.id);
    return p && p.qty > 0 ? { p, qty: Math.max(1, Math.min(l.qty, MAX_QTY, p.qty)) } : null;
  }).filter(Boolean);
}

// Returns true when the product is in the cart afterwards
function addToCart(id, qty) {
  const p = getProducts().find((x) => x.id === id);
  if (!p || p.qty < 1) { toast(t('toast.outOfStock')); return false; }
  const cap = Math.min(MAX_QTY, p.qty);
  const cart = getCart();
  const line = cart.find((l) => l.id === id);
  const have = line ? line.qty : 0;
  const next = Math.min(cap, have + qty);
  if (next === have) { toast(t('toast.cartMax', { cap, name: p.name })); return true; }
  if (line) line.qty = next; else cart.push({ id, qty: next });
  setCart(cart);
  updateCartCount();
  toast(have + qty > cap ? t('toast.cartLimited', { cap, name: p.name }) : t('toast.cartAdded', { qty, name: p.name }));
  return true;
}

// ---------- Ratings & reviews ----------
const getReviews = () => load(KEY.reviews, []);
const starText = (n) => { const r = Math.round(n); return '★'.repeat(r) + '☆'.repeat(5 - r); };

// Average rating per product and per wholesaler (reviews of deleted products are ignored)
function reviewIndex() {
  const alive = new Set(getProducts().map((p) => p.id));
  const byProduct = new Map();
  const bySeller = new Map();
  getReviews().filter((r) => alive.has(r.productId)).forEach((r) => {
    [[byProduct, r.productId], [bySeller, r.ownerId]].forEach(([m, k]) => {
      const s = m.get(k) || { sum: 0, count: 0 };
      s.sum += r.rating;
      s.count += 1;
      m.set(k, s);
    });
  });
  return { byProduct, bySeller };
}
const avgOf = (s) => (s && s.count ? s.sum / s.count : 0);

function ratingHtml(s, noneKey = 'rev.none') {
  if (!s || !s.count) return `<div class="rating none">${te(noneKey)}</div>`;
  const avg = avgOf(s);
  return `<div class="rating" aria-label="${te('rating.aria' + (s.count === 1 ? '.one' : '.other'), { avg: avg.toFixed(1), n: s.count })}"><span class="stars" aria-hidden="true">${starText(avg)}</span> <b>${avg.toFixed(1)}</b> <small>(${s.count})</small></div>`;
}

// A product can be reviewed only after the order containing it has been delivered.
// Returns 'delivered', 'ordered' (placed but not delivered yet) or 'none'.
function purchaseState(customerId, productId) {
  const mine = getOrders().filter((o) => o.customerId === customerId && o.items.some((i) => i.productId === productId));
  if (!mine.length) return 'none';
  return mine.some((o) => o.status === 'Delivered') ? 'delivered' : 'ordered';
}

function reviewsHtml(p, user) {
  const list = getReviews().filter((r) => r.productId === p.id).sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  const idx = reviewIndex();
  const mine = list.find((r) => r.customerId === user.id);
  const state = purchaseState(user.id, p.id);
  // Writing needs a delivered order; an existing review can always be edited or deleted
  const canWrite = state === 'delivered' || !!mine;

  const form = canWrite ? `
    <form id="review-form" data-id="${esc(p.id)}" novalidate>
      <h4>${te(mine ? 'rev.update' : 'rev.write')}</h4>
      <fieldset class="star-input">
        <legend class="sr-only">${te('rev.yourRating')}</legend>
        ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rating" id="rate${n}" value="${n}"${mine && mine.rating === n ? ' checked' : ''}><label for="rate${n}" title="${esc(tp('rev.star', n, { n }))}"><span class="sr-only">${esc(tp('rev.star', n, { n }))}</span>★</label>`).join('')}
      </fieldset>
      <label><span>${te('rev.yourReview')}</span>
        <textarea name="comment" rows="3" maxlength="500" placeholder="${te('ph.review')}">${esc(mine ? mine.comment : '')}</textarea>
      </label>
      <p class="form-msg" id="review-msg" role="status"></p>
      <div class="rev-actions">
        <button type="submit" class="btn btn-small">${te(mine ? 'rev.updateBtn' : 'rev.submit')}</button>
        ${mine ? `<button type="button" class="btn btn-danger btn-small" data-act="del-review">${te('rev.delete')}</button>` : ''}
      </div>
    </form>` : `<p class="rev-hint">${te(state === 'ordered' ? 'rev.hintOrdered' : 'rev.hintNone')}</p>`;

  return `
    <section class="reviews" data-id="${esc(p.id)}">
      <h3>${te('rev.title')}</h3>
      <div class="rev-summary">
        ${ratingHtml(idx.byProduct.get(p.id), 'rev.first')}
        <div class="rev-seller">${te('rev.sellerLabel')} <b>${esc(p.store)}</b>: ${ratingHtml(idx.bySeller.get(p.ownerId), 'rev.notRated')}</div>
      </div>
      <div id="review-anchor">${form}</div>
      <div class="rev-list">${list.map((r) => `
        <article class="rev">
          <div class="rev-head"><span class="stars" aria-hidden="true">${starText(r.rating)}</span><b>${esc(r.customerName)}</b><small>${te('rev.verified')} · ${esc(fmtDay(r.updated || r.created))}</small></div>
          <span class="sr-only">${te('rev.srStars', { n: r.rating })}</span>
          ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
        </article>`).join('')}</div>
    </section>`;
}

// ---------- Product images ----------
function thumb(p, { wish = false } = {}) {
  const imgs = productImages(p);
  const main = imgs.length ? `<img src="${esc(imgs[0])}" alt="${esc(p.name)}">` : esc(p.emoji || '📦');
  const nav = imgs.length > 1
    ? `<div class="thumb-nav">${imgs.map((src, i) => `<button type="button" class="${i === 0 ? 'active' : ''}" aria-label="${te('alt.photo', { n: i + 1 })}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>`
    : '';
  const on = wish && isWished(p.id);
  const heart = wish
    ? `<button type="button" class="wish${on ? ' on' : ''}" data-id="${esc(p.id)}" aria-pressed="${on}" aria-label="${te(on ? 'aria.wishRemove' : 'aria.wishAdd')}">♥</button>`
    : '';
  return `<div class="media"><div class="thumb">${main}</div>${heart}${nav}</div>`;
}

// Switch the main photo when a small preview is clicked
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.thumb-nav button');
  if (!btn) return;
  const media = btn.closest('.media');
  media.querySelector('.thumb img').src = btn.querySelector('img').src;
  media.querySelectorAll('.thumb-nav button').forEach((b) => b.classList.toggle('active', b === btn));
});

const readImage = (file) => new Promise((resolve) => {
  if (!file) return resolve('');
  if (!file.type.startsWith('image/')) return resolve(null);
  // Downscale so localStorage doesn't fill up
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';            // JPEG has no transparency; keep PNG backgrounds white, not black
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => resolve(null);
    img.src = reader.result;
  };
  reader.onerror = () => resolve(null);
  reader.readAsDataURL(file);
});

// ---------- Auth ----------
const normMobile = (s) => s.replace(/[\s\-()]/g, '');
const validMobile = (m) => /^\+?\d{10,15}$/.test(m);
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
let mode = 'login';
const authForm = $('auth-form');
const authMsg = $('auth-msg');

function setMode(m) {
  mode = m;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === m));
  $('auth-submit').textContent = t(m === 'login' ? 'auth.login' : 'auth.createAccount');
  authForm.elements.password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
  authMsg.textContent = '';
  syncRoleFields();
}

function syncRoleFields() {
  const role = authForm.elements.role.value;
  document.querySelectorAll('.reg-only').forEach((el) => {
    const needsWholesaler = el.classList.contains('wholesaler-only');
    el.hidden = mode !== 'register' || (needsWholesaler && role !== 'wholesaler');
    el.querySelector('input').required = !el.hidden;   // every visible register field is mandatory
  });
  authForm.classList.toggle('register', mode === 'register');
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
$('cta-register').addEventListener('click', () => {
  if (!resetBox.hidden) closeReset();
  setMode('register');
});
authForm.querySelectorAll('input[name="role"]').forEach((r) => r.addEventListener('change', syncRoleFields));

function authError(msg) { authMsg.textContent = msg; authMsg.className = 'form-msg error'; }

authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = authForm.elements;
  const role = f.role.value;
  const email = f.email.value.trim().toLowerCase();
  const password = f.password.value;
  const users = getUsers();

  if (!validEmail(email)) return authError(t('err.email'));
  if (password.length < 4) return authError(t('err.pass4'));

  if (mode === 'login') {
    const user = users.find((u) => u.email === email && u.password === password && u.role === role);
    if (!user) return authError(t('err.noAccount', { role: t(`role.${role}`).toLowerCase() }));
    setSession(user.id);
  } else {
    const name = f.name.value.trim();
    const store = f.store.value.trim();
    const mobile = normMobile(f.mobile.value);
    if (!name) return authError(t('err.name'));
    if (role === 'wholesaler' && !store) return authError(t('err.storeReq'));
    if (!f.confirm.value) return authError(t('err.confirmReq'));
    if (f.confirm.value !== password) return authError(t('err.pwMismatch'));
    if (!f.mobile.value.trim()) return authError(t('err.mobileReq'));
    if (!validMobile(mobile)) return authError(t('err.mobileInvalid'));
    if (users.some((u) => u.email === email)) return authError(t('err.emailTaken'));
    if (users.some((u) => u.mobile === mobile)) return authError(t('err.mobileTaken'));
    const user = { id: uid(), role, name, email, mobile, password, ...(role === 'wholesaler' ? { store } : {}) };
    users.push(user);
    save(KEY.users, users);
    setSession(user.id);
  }
  authForm.reset();
  setMode('login');
  page = 'home';
  route();
});

// ---------- Forgot password (OTP via email or mobile) ----------
// DEMO_MODE: a browser-only page cannot send real SMS/email, so the OTP is shown on screen.
// In production the server generates, sends (SMS gateway / email service) and verifies the OTP,
// and it is NEVER returned to the browser.
const DEMO_MODE = true;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_TRIES = 5;
const RESEND_WAIT_S = 30;

const resetBox = $('reset-box');
const reqForm = $('reset-request');
const verForm = $('reset-verify');
let otpState = null;   // { userId, otp, expires, tries, channel, target }
let resendTimer;
let resendLeft = 0;

function openReset() {
  $('auth-tabs').hidden = true;
  authForm.hidden = true;
  resetBox.hidden = false;
  reqForm.hidden = false;
  verForm.hidden = true;
  reqForm.reset();
  syncChannel();
  msgTo('reset-msg1', '');
}

function closeReset() {
  otpState = null;
  clearInterval(resendTimer);
  resendLeft = 0;
  renderResendBtn();
  resetBox.hidden = true;
  $('auth-tabs').hidden = false;
  authForm.hidden = false;
  reqForm.reset();
  verForm.reset();
  setMode('login');
}

function updateChannelText() {
  const email = reqForm.elements.channel.value === 'email';
  const input = reqForm.elements.identifier;
  $('reset-id-text').textContent = t(email ? 'reset.idEmail' : 'reset.idMobile');
  input.placeholder = t(email ? 'ph.resetEmail' : 'ph.resetMobile');
}

function syncChannel() {
  const email = reqForm.elements.channel.value === 'email';
  const input = reqForm.elements.identifier;
  input.type = email ? 'email' : 'tel';
  input.value = '';
  updateChannelText();
}

const maskEmail = (e) => e.replace(/^(.).*(@.*)$/, '$1***$2');
const maskMobile = (m) => m.slice(0, 2) + '*'.repeat(Math.max(0, m.length - 4)) + m.slice(-2);

function makeOtp() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, '0');
}

function renderResendBtn() {
  const btn = $('resend-otp');
  btn.disabled = resendLeft > 0;
  btn.textContent = resendLeft > 0 ? t('reset.resendIn', { s: resendLeft }) : t('reset.resend');
}

function startResendCooldown() {
  resendLeft = RESEND_WAIT_S;
  renderResendBtn();
  clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    resendLeft -= 1;
    if (resendLeft <= 0) { resendLeft = 0; clearInterval(resendTimer); }
    renderResendBtn();
  }, 1000);
}

function renderOtpTexts() {
  if (!otpState) return;
  const target = otpState.channel === 'email' ? maskEmail(otpState.target) : maskMobile(otpState.target);
  $('otp-sent-to').textContent = t('reset.sentTo', { target });
  const demo = $('demo-otp');
  demo.hidden = !DEMO_MODE;
  if (DEMO_MODE) demo.innerHTML = t(otpState.channel === 'email' ? 'reset.demoEmail' : 'reset.demoSms', { otp: otpState.otp });
}

function issueOtp(user, channel) {
  const target = channel === 'email' ? user.email : user.mobile;
  otpState = { userId: user.id, otp: makeOtp(), expires: Date.now() + OTP_TTL_MS, tries: 0, channel, target };
  renderOtpTexts();
  startResendCooldown();
}

$('forgot-link').addEventListener('click', openReset);
resetBox.querySelectorAll('.reset-back').forEach((b) => b.addEventListener('click', closeReset));
reqForm.querySelectorAll('input[name="channel"]').forEach((r) => r.addEventListener('change', syncChannel));

reqForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const channel = reqForm.elements.channel.value;
  const raw = reqForm.elements.identifier.value.trim();
  const users = getUsers();
  let user;
  if (channel === 'email') {
    if (!validEmail(raw)) return msgTo('reset-msg1', t('err.email'), 'error');
    user = users.find((u) => u.email === raw.toLowerCase());
  } else {
    const m = normMobile(raw);
    if (!validMobile(m)) return msgTo('reset-msg1', t('reset.invalidMobile'), 'error');
    user = users.find((u) => u.mobile === m);
  }
  if (!user) return msgTo('reset-msg1', t('reset.noAccount'), 'error');
  if (channel === 'mobile' && !user.mobile) return msgTo('reset-msg1', t('reset.noMobile'), 'error');

  issueOtp(user, channel);
  reqForm.hidden = true;
  verForm.hidden = false;
  verForm.reset();
  msgTo('reset-msg2', '');
});

$('resend-otp').addEventListener('click', () => {
  if (!otpState) return;
  const user = getUsers().find((u) => u.id === otpState.userId);
  if (!user) return;
  issueOtp(user, otpState.channel);
  verForm.elements.otp.value = '';
  msgTo('reset-msg2', t('reset.newSent'), 'ok');
});

verForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = verForm.elements;
  if (!otpState) return msgTo('reset-msg2', t('reset.reqFirst'), 'error');
  if (Date.now() > otpState.expires) { otpState = null; return msgTo('reset-msg2', t('reset.expired'), 'error'); }
  if (!/^\d{6}$/.test(f.otp.value.trim())) return msgTo('reset-msg2', t('reset.otp6'), 'error');
  if (f.newpass.value.length < 4) return msgTo('reset-msg2', t('err.pass4'), 'error');
  if (f.newpass.value !== f.newpass2.value) return msgTo('reset-msg2', t('err.pwMismatch'), 'error');

  otpState.tries += 1;
  if (f.otp.value.trim() !== otpState.otp) {
    if (otpState.tries >= OTP_MAX_TRIES) { otpState = null; return msgTo('reset-msg2', t('reset.tooMany'), 'error'); }
    return msgTo('reset-msg2', t('reset.wrong', { n: OTP_MAX_TRIES - otpState.tries }), 'error');
  }

  const users = getUsers();
  const user = users.find((u) => u.id === otpState.userId);
  user.password = f.newpass.value;
  save(KEY.users, users);
  closeReset();
  authMsg.textContent = t('reset.done');
  authMsg.className = 'form-msg ok';
});

$('logout-btn').addEventListener('click', () => {
  clearSession();
  page = 'home';
  $('contact-form').reset();
  route();
});
$('logo').addEventListener('click', (e) => { e.preventDefault(); page = 'home'; route(); });
$('profile-btn').addEventListener('click', () => { page = page === 'profile' ? 'home' : 'profile'; route(); });
$('help-btn').addEventListener('click', () => { page = page === 'help' ? 'home' : 'help'; route(); });

// Links like "Help & FAQ" in the footer, and the landing-page menu while another page is showing
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); page = go.dataset.go; route(); return; }
  if (e.target.closest('#nav-links a') && page !== 'home') { page = 'home'; route(); }   // the anchor then scrolls to its section
});

// ---------- Help page: FAQ + contact form ----------
const FAQ_GROUPS = [['faq.g.customers', [1, 2, 3, 4, 5, 6]], ['faq.g.wholesalers', [7, 8, 9, 10]], ['faq.g.account', [11, 12]]];

function renderFaq() {
  const open = new Set([...document.querySelectorAll('#faq-list details[open]')].map((d) => d.dataset.q));
  $('faq-list').innerHTML = FAQ_GROUPS.map(([group, ids]) => `
    <h4 class="faq-group">${te(group)}</h4>
    ${ids.map((n) => `<details data-q="${n}"${open.has(String(n)) ? ' open' : ''}><summary>${te(`faq.q${n}`)}</summary><p>${te(`faq.a${n}`)}</p></details>`).join('')}`).join('');
}

function renderHelp(user) {
  renderFaq();
  const f = $('contact-form').elements;
  if (user) {   // save logged-in people some typing
    if (!f.name.value) f.name.value = user.name;
    if (!f.email.value) f.email.value = user.email;
  }
}

$('contact-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const name = f.name.value.trim();
  const email = f.email.value.trim();
  const message = f.message.value.trim();
  if (!name) return msgTo('contact-msg', t('err.name'), 'error');
  if (!validEmail(email)) return msgTo('contact-msg', t('err.email'), 'error');
  if (message.length < 10) return msgTo('contact-msg', t('contact.errMsg'), 'error');

  const id = uid();
  const all = load(KEY.messages, []);
  all.push({ id, userId: getSession() || null, name, email, subject: f.subject.value, message, created: Date.now() });
  try { save(KEY.messages, all.slice(-200)); }
  catch { return msgTo('contact-msg', t('msg.storageFull'), 'error'); }
  f.message.value = '';
  msgTo('contact-msg', t('contact.sent', { ref: id.slice(-6).toUpperCase() }), 'ok');
});

// ---------- Shared product-form validation (add form and edit dialog) ----------
function parseProductForm(f, ownerId, excludeId, minQty) {
  const name = f.pname.value.trim();
  const store = f.pstore.value.trim();
  if (!name || !store) return { error: t('msg.prodNameStore') };

  const dup = getProducts().find((p) => p.ownerId === ownerId && p.id !== excludeId && normText(p.name) === normText(name));
  if (dup) {
    alert(t('msg.dup', { name: dup.name }));
    return { silent: true };
  }

  const qty = parseQty(f.pqty.value, minQty);
  if (qty === null) return { error: t('msg.qtyRange', { min: minQty, max: money(MAX_STOCK) }) };
  const price = parsePrice(f.pprice.value);
  if (price === null) return { error: t('msg.priceRange', { max: rs(MAX_PRICE) }) };

  const category = CATEGORIES.includes(f.pcat.value) ? f.pcat.value : 'Other';
  const description = f.pdesc.value.trim().slice(0, 300);
  return { data: { name, store, category, description, price, qty } };
}

// ---------- Wholesaler ----------
const productForm = $('product-form');
const ownerOrders = (ownerId) => getOrders().filter((o) => o.ownerId === ownerId).sort((a, b) => b.date - a.date);
const customerName = (o) => o.customerName || (getUsers().find((u) => u.id === o.customerId) || {}).name || 'Customer';
const customerMobile = (o) => o.customerMobile || (getUsers().find((u) => u.id === o.customerId) || {}).mobile || '';

function renderWholesaler(user) {
  const mine = getProducts().filter((p) => p.ownerId === user.id);
  const products = mine.filter((p) => matchesSearch(p, $('w-search').value));
  const orders = ownerOrders(user.id);
  const units = orders.reduce((s, o) => s + unitsOf(o), 0);
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const stock = mine.reduce((s, p) => s + p.qty, 0);
  const idx = reviewIndex();
  const sellerStat = idx.bySeller.get(user.id);

  $('w-stats').innerHTML = `
    <div class="stat"><strong>${mine.length}</strong><span>${te('stat.products')}</span></div>
    <div class="stat"><strong>${stock}</strong><span>${te('stat.stock')}</span></div>
    <div class="stat"><strong>${units}</strong><span>${te('stat.sold')}</span></div>
    <div class="stat"><strong>${rs(revenue)}</strong><span>${te('stat.sales')}</span></div>
    <div class="stat"><strong>${sellerStat ? `${avgOf(sellerStat).toFixed(1)} ★` : '—'}</strong><span>${sellerStat ? (sellerStat.count === 1 ? te('stat.ratingOne') : te('stat.ratingMany', { n: sellerStat.count })) : te('stat.noReviews')}</span></div>`;

  const myReviews = getReviews().filter((r) => r.ownerId === user.id && idx.byProduct.has(r.productId))
    .sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  $('w-reviews').innerHTML = myReviews.length ? `<div class="rev-list">${myReviews.map((r) => `
    <article class="rev">
      <div class="rev-head"><span class="stars" aria-hidden="true">${starText(r.rating)}</span><b>${esc(r.productName || '—')}</b><small>${te('by', { name: r.customerName })} · ${esc(fmtDay(r.updated || r.created))}</small></div>
      <span class="sr-only">${te('rev.srStars', { n: r.rating })}</span>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
    </article>`).join('')}</div>` : `<p class="empty">${te('w.noReviews')}</p>`;

  if (!productForm.elements.pstore.value) productForm.elements.pstore.value = user.store || '';

  $('w-products').innerHTML = products.length ? products.map((p) => `
    <article class="product" data-id="${esc(p.id)}">
      ${thumb(p)}
      <div class="p-body">
        <div class="p-name">${esc(p.name)}</div>
        <div class="p-store">🏬 ${esc(p.store)}</div>
        <div class="p-price"><strong>${rs(priceOf(p))}</strong> ${te('card.perUnit')}</div>
        ${ratingHtml(idx.byProduct.get(p.id))}
        <div class="tags"><span class="cat-tag">${te(`cat.${categoryOf(p)}`)}</span><span class="badge ${p.qty ? '' : 'out'}">${p.qty ? te('card.inStock', { n: p.qty }) : te('card.out')}</span></div>
        <div class="price-edit">
          <label><span>${te('card.priceRs')}</span>
            <input type="number" class="price-input" min="0.01" max="${MAX_PRICE}" step="0.01" value="${priceOf(p)}" aria-label="${te('aria.priceFor', { name: p.name })}">
          </label>
          <label><span>${te('card.quantity')}</span>
            <input type="number" class="stock-input" min="0" max="${MAX_STOCK}" step="1" value="${p.qty}" aria-label="${te('aria.stockFor', { name: p.name })}">
          </label>
          <button class="btn btn-outline btn-small save-price">${te('card.save')}</button>
        </div>
        <div class="p-actions">
          <button class="btn btn-outline btn-small edit-btn">${te('card.edit')}</button>
          <button class="btn btn-danger btn-small del-btn">${te('card.delete')}</button>
        </div>
      </div>
    </article>`).join('') : `<p class="empty">${te(mine.length ? 'w.noMatch' : 'w.noProducts')}</p>`;

  $('w-orders').innerHTML = orders.length ? `
    <div class="table-wrap"><table>
      <thead><tr><th>${te('th.date')}</th><th>${te('th.order')}</th><th>${te('th.customer')}</th><th>${te('th.items')}</th><th>${te('th.total')}</th><th>${te('th.address')}</th><th>${te('th.status')}</th></tr></thead>
      <tbody>${orders.map((o) => `
        <tr data-id="${esc(o.id)}">
          <td>${esc(fmtDate(o.date))}</td>
          <td>#${esc(orderCode(o))}</td>
          <td>${esc(customerName(o))}<small>${esc(customerMobile(o))}</small></td>
          <td>${o.items.map((i) => `${esc(i.name)} × ${i.qty}`).join('<br>')}</td>
          <td class="num">${rs(o.total)}</td>
          <td>${o.address ? esc(o.address) : `<small>${te('w.noAddress')}</small>`}</td>
          <td><select class="status-select" aria-label="${te('aria.statusOf', { code: orderCode(o) })}">${STATUSES.map((s) => `<option value="${s}"${s === o.status ? ' selected' : ''}>${te(`status.${s}`)}</option>`).join('')}</select></td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : `<p class="empty">${te('w.noOrders')}</p>`;
}

$('w-search').addEventListener('input', () => renderWholesaler(currentUser()));

function saveQuick(card) {
  const price = parsePrice(card.querySelector('.price-input').value);
  if (price === null) { toast(t('msg.priceRange', { max: rs(MAX_PRICE) })); return; }
  const qty = parseQty(card.querySelector('.stock-input').value, 0);
  if (qty === null) { toast(t('msg.qtyRange', { min: 0, max: money(MAX_STOCK) })); return; }
  const products = getProducts();
  const p = products.find((x) => x.id === card.dataset.id && x.ownerId === currentUser().id);
  if (!p) return;
  p.price = price;
  p.qty = qty;
  save(KEY.products, products);
  toast(t('msg.productUpdated'));
  renderWholesaler(currentUser());
}

$('w-products').addEventListener('keydown', (e) => {
  const c = e.target.classList;
  if (e.key === 'Enter' && (c.contains('price-input') || c.contains('stock-input'))) { e.preventDefault(); saveQuick(e.target.closest('.product')); }
});

$('w-products').addEventListener('click', (e) => {
  const card = e.target.closest('.product');
  if (!card) return;
  const cl = e.target.classList;
  if (cl.contains('save-price')) return saveQuick(card);
  if (cl.contains('edit-btn')) return openEdit(card.dataset.id);
  if (!cl.contains('del-btn')) return;
  if (!confirm(t('msg.confirmDelete'))) return;
  const user = currentUser();
  save(KEY.products, getProducts().filter((p) => !(p.id === card.dataset.id && p.ownerId === user.id)));
  toast(t('msg.productDeleted'));
  renderWholesaler(user);
});

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = currentUser();
  const f = productForm.elements;
  const r = parseProductForm(f, user.id, null, 1);
  if (r.silent) return;
  if (r.error) return msgTo('product-msg', r.error, 'error');

  const files = [...f.pimage.files];
  if (files.length > MAX_PHOTOS) return msgTo('product-msg', t('msg.maxPhotos', { n: MAX_PHOTOS }), 'error');
  const images = await Promise.all(files.map(readImage));
  if (images.includes(null)) return msgTo('product-msg', t('msg.badImage'), 'error');

  const products = getProducts();
  products.push({ id: uid(), ownerId: user.id, ...r.data, emoji: '📦', images, created: Date.now() });
  try { save(KEY.products, products); }
  catch { return msgTo('product-msg', t('msg.storageFull'), 'error'); }

  productForm.reset();
  msgTo('product-msg', '');
  toast(t('msg.productAdded'));
  renderWholesaler(user);
});

// Wholesaler: change order status
$('w-orders').addEventListener('change', (e) => {
  if (!e.target.classList.contains('status-select')) return;
  const user = currentUser();
  const orders = getOrders();
  const o = orders.find((x) => x.id === e.target.closest('tr').dataset.id && x.ownerId === user.id);
  if (!o || !STATUSES.includes(e.target.value)) return;
  o.status = e.target.value;
  save(KEY.orders, orders);
  toast(t('msg.statusMarked', { code: orderCode(o), status: statusLabel(o.status) }));
});

// Wholesaler: CSV download (cells starting with = + - @ are prefixed so spreadsheets don't run them as formulas).
// The file is always in English so it opens the same way everywhere.
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
$('csv-btn').addEventListener('click', () => {
  const orders = ownerOrders(currentUser().id);
  if (!orders.length) return toast(t('msg.noOrdersCsv'));
  const rows = [['Order ID', 'Date', 'Customer', 'Mobile', 'Items', 'Total amount (Rs)', 'Delivery address', 'Status'],
    ...orders.map((o) => [orderCode(o), new Date(o.date).toLocaleString('en-IN'), customerName(o), customerMobile(o),
      o.items.map((i) => `${i.name} x ${i.qty}`).join('; '), o.total, o.address || '', o.status])];
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- Wholesaler: edit product dialog ----------
const editForm = $('edit-form');
let editState = null;   // { id, images: [kept photos] }

function renderEditPhotos() {
  $('edit-photos').innerHTML = editState.images.length
    ? editState.images.map((src, i) => `<div class="edit-photo"><img src="${esc(src)}" alt="${te('alt.photo', { n: i + 1 })}"><button type="button" data-rm="${i}" aria-label="${te('aria.removePhoto', { n: i + 1 })}">✕</button></div>`).join('')
    : `<small class="field-label">${te('edit.noPhotos')}</small>`;
}

function openEdit(id) {
  const user = currentUser();
  const p = getProducts().find((x) => x.id === id && x.ownerId === user.id);
  if (!p) return;
  editState = { id, images: [...productImages(p)] };
  const f = editForm.elements;
  f.pname.value = p.name;
  f.pstore.value = p.store;
  f.pcat.value = categoryOf(p);
  f.pqty.value = p.qty;
  f.pprice.value = priceOf(p);
  f.pdesc.value = p.description || '';
  f.pimage.value = '';
  msgTo('edit-msg', '');
  renderEditPhotos();
  $('edit-dialog').showModal();
}

$('edit-photos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]');
  if (!b || !editState) return;
  editState.images.splice(Number(b.dataset.rm), 1);
  renderEditPhotos();
});

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editState) return;
  const user = currentUser();
  const f = editForm.elements;
  const r = parseProductForm(f, user.id, editState.id, 0);
  if (r.silent) return;
  if (r.error) return msgTo('edit-msg', r.error, 'error');

  const files = [...f.pimage.files];
  if (editState.images.length + files.length > MAX_PHOTOS) return msgTo('edit-msg', t('msg.editMaxPhotos', { n: MAX_PHOTOS }), 'error');
  const added = await Promise.all(files.map(readImage));
  if (added.includes(null)) return msgTo('edit-msg', t('msg.badImage'), 'error');

  const products = getProducts();
  const p = products.find((x) => x.id === editState.id && x.ownerId === user.id);
  if (!p) return msgTo('edit-msg', t('msg.noProduct'), 'error');
  Object.assign(p, r.data, { images: [...editState.images, ...added] });
  delete p.image;
  try { save(KEY.products, products); }
  catch { return msgTo('edit-msg', t('msg.storageFull'), 'error'); }

  $('edit-dialog').close();
  editState = null;
  toast(t('msg.productUpdated'));
  renderWholesaler(user);
});

// ---------- Customer: shop ----------
const shop = { cat: 'All', sort: 'new', wish: false };
const SORTS = {
  new: (a, b) => (b.created || 0) - (a.created || 0),
  'price-asc': (a, b) => priceOf(a) - priceOf(b),
  'price-desc': (a, b) => priceOf(b) - priceOf(a),
  name: (a, b) => a.name.localeCompare(b.name),
};

function renderChips() {
  $('c-chips').innerHTML = ['All', ...CATEGORIES].map((c) =>
    `<button type="button" class="chip${shop.cat === c ? ' active' : ''}" data-cat="${c}">${c === 'All' ? te('chip.all') : te(`cat.${c}`)}</button>`).join('')
    + `<button type="button" class="chip${shop.wish ? ' active' : ''}" data-wish>${te('chip.wish', { n: getWish().length })}</button>`;
}

function stepper(o) {
  const idx = Math.max(0, STATUSES.indexOf(o.status));
  return `<ol class="track" aria-label="${te('aria.orderStatus', { status: statusLabel(o.status) })}">${STATUSES.map((s, i) => `<li class="${i <= idx ? 'done' : ''}${i === idx ? ' current' : ''}">${te(`status.${s}`)}</li>`).join('')}</ol>`;
}

function renderCustomer(user) {
  const all = getProducts();
  renderChips();
  const wished = new Set(getWish());
  const idx = reviewIndex();
  const products = all
    .filter((p) => matchesSearch(p, $('c-search').value) && (shop.cat === 'All' || categoryOf(p) === shop.cat) && (!shop.wish || wished.has(p.id)))
    .sort(shop.sort === 'rating'
      ? (a, b) => avgOf(idx.byProduct.get(b.id)) - avgOf(idx.byProduct.get(a.id)) || ((idx.byProduct.get(b.id) || {}).count || 0) - ((idx.byProduct.get(a.id) || {}).count || 0)
      : (SORTS[shop.sort] || SORTS.new));
  const existing = new Set(all.map((p) => p.id));

  $('c-products').innerHTML = products.length ? products.map((p) => {
    const max = Math.min(MAX_QTY, p.qty);
    return `
    <article class="product" data-id="${esc(p.id)}">
      ${thumb(p, { wish: true })}
      <div class="p-body">
        <button type="button" class="p-name" data-act="detail">${esc(p.name)}</button>
        <div class="p-store">🏬 ${esc(p.store)}</div>
        <div class="p-price"><strong>${rs(priceOf(p))}</strong> ${te('card.perUnit')}</div>
        ${ratingHtml(idx.byProduct.get(p.id))}
        <div class="tags"><span class="cat-tag">${te(`cat.${categoryOf(p)}`)}</span><span class="badge ${p.qty ? '' : 'out'}">${p.qty ? te('card.available', { n: p.qty }) : te('card.out')}</span></div>
        ${p.qty ? `
        <div class="qty-row">
          <label><span>${te('card.qty')}</span> <select class="buy-qty" aria-label="${te('aria.qtyOf', { name: p.name })}">${qtyOptions(max, 1)}</select></label>
          <span class="total">${te('card.totalAmount')}: <strong class="total-val">${rs(priceOf(p))}</strong></span>
        </div>` : ''}
        <div class="p-actions">
          <button class="btn btn-outline" data-act="add"${p.qty ? '' : ' disabled'}>${te('card.add')}</button>
          <button class="btn" data-act="buy"${p.qty ? '' : ' disabled'}>${te('card.buy')}</button>
        </div>
      </div>
    </article>`;
  }).join('') : `<p class="empty">${te(!all.length ? 'c.noProducts' : shop.wish && !wished.size ? 'c.wishEmpty' : 'w.noMatch')}</p>`;

  const orders = getOrders().filter((o) => o.customerId === user.id).sort((a, b) => b.date - a.date);
  $('c-orders').innerHTML = orders.length ? orders.map((o) => `
    <div class="order-card">
      <div class="oc-head">
        <div><b>${te('order.num', { code: orderCode(o) })}</b><small>${esc(fmtDate(o.date))} · ${esc(o.store)}</small></div>
        <div class="oc-total">${te('order.total')}<b>${rs(o.total)}</b></div>
      </div>
      ${stepper(o)}
      <ul class="oc-items">${o.items.map((i) => `<li><div class="oi-main"><span>${esc(i.name)} × ${i.qty} <small>${te('order.each', { price: rs(i.price) })}</small></span>${i.productId && existing.has(i.productId)
        ? (o.status === 'Delivered'
          ? `<button type="button" class="link-btn oi-review" data-review-product="${esc(i.productId)}">${te('order.review')}</button>`
          : `<small class="oi-note">${te('order.afterDelivery')}</small>`)
        : ''}</div><span>${rs(i.total)}</span></li>`).join('')}</ul>
      <div class="oc-foot">
        <small>${o.address ? `📍 ${esc(o.address)}` : te('order.noAddress')}</small>
        <button type="button" class="btn btn-outline btn-small" data-receipt="${esc(o.id)}">${te('order.receipt')}</button>
      </div>
    </div>`).join('') : `<p class="empty">${te('c.noOrders')}</p>`;

  updateCartCount();
}

$('c-search').addEventListener('input', () => renderCustomer(currentUser()));
$('c-sort').addEventListener('change', (e) => { shop.sort = e.target.value; renderCustomer(currentUser()); });
$('c-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  if (b.hasAttribute('data-wish')) shop.wish = !shop.wish;
  else shop.cat = b.dataset.cat;
  renderCustomer(currentUser());
});

// Live "Total amount" when the quantity changes (product cards and the detail dialog)
function qtyChanged(e) {
  if (!e.target.classList.contains('buy-qty')) return;
  const root = e.target.closest('.product, .detail');
  const p = getProducts().find((x) => x.id === root.dataset.id);
  if (!p) return;
  root.querySelector('.total-val').textContent = rs(lineTotal(priceOf(p), parseInt(e.target.value, 10)));
}

function toggleWishUi(id) {
  const on = toggleWish(id);
  document.querySelectorAll(`.wish[data-id="${CSS.escape(id)}"]`).forEach((b) => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-label', t(on ? 'aria.wishRemove' : 'aria.wishAdd'));
  });
  toast(t(on ? 'wish.added' : 'wish.removed'));
  renderChips();
  if (shop.wish) renderCustomer(currentUser());
}

function shopClick(e) {
  const root = e.target.closest('.product, .detail');
  if (!root || !root.dataset.id) return;
  const id = root.dataset.id;
  const el = e.target;
  if (el.closest('.wish')) return toggleWishUi(id);
  const actEl = el.closest('[data-act]');
  const act = actEl && actEl.dataset.act;
  if (act === 'add' || act === 'buy') {
    const sel = root.querySelector('.buy-qty');
    const qty = sel ? parseInt(sel.value, 10) : 1;
    if (addToCart(id, qty) && act === 'buy') { $('detail-dialog').close(); openCart(); }
    return;
  }
  if (root.classList.contains('product') && (act === 'detail' || el.closest('.thumb'))) openDetail(id);
}

$('c-products').addEventListener('change', qtyChanged);
$('c-products').addEventListener('click', shopClick);
$('detail-body').addEventListener('change', qtyChanged);
$('detail-body').addEventListener('click', shopClick);

// ---------- Customer: product detail dialog ----------
let detailReviewOnly = false;   // true when opened from an order's "Rate & review" link: reviews only, no buying
let detailId = null;

function renderDetail(id) {
  const p = getProducts().find((x) => x.id === id);
  if (!p) return false;
  detailId = id;
  const max = Math.min(MAX_QTY, p.qty);
  const idx = reviewIndex();
  $('detail-dialog').querySelector('.dlg-head h3').textContent = t(detailReviewOnly ? 'detail.reviewTitle' : 'detail.title');

  if (detailReviewOnly) {
    const img = productImages(p)[0];
    $('detail-body').innerHTML = `
      <div class="review-head">
        <div class="rh-img">${img ? `<img src="${esc(img)}" alt="">` : esc(p.emoji || '📦')}</div>
        <div>
          <h3>${esc(p.name)}</h3>
          <div class="p-store">🏬 ${esc(p.store)}</div>
          ${ratingHtml(idx.byProduct.get(p.id))}
        </div>
      </div>
      ${reviewsHtml(p, currentUser())}`;
    return true;
  }

  $('detail-body').innerHTML = `
    <div class="detail" data-id="${esc(p.id)}">
      ${thumb(p, { wish: true })}
      <div class="detail-info">
        <div class="tags"><span class="cat-tag">${te(`cat.${categoryOf(p)}`)}</span><span class="badge ${p.qty ? '' : 'out'}">${p.qty ? te('card.available', { n: p.qty }) : te('card.out')}</span></div>
        <h3>${esc(p.name)}</h3>
        <div class="p-store">🏬 ${esc(p.store)}</div>
        ${ratingHtml(idx.byProduct.get(p.id))}
        <p class="desc">${p.description ? esc(p.description) : te('detail.noDesc')}</p>
        <div class="p-price"><strong>${rs(priceOf(p))}</strong> ${te('card.perUnit')}</div>
        ${p.qty ? `
        <div class="qty-row">
          <label><span>${te('card.qty')}</span> <select class="buy-qty" aria-label="${te('aria.qtyOf', { name: p.name })}">${qtyOptions(max, 1)}</select></label>
          <span class="total">${te('card.totalAmount')}: <strong class="total-val">${rs(priceOf(p))}</strong></span>
        </div>` : ''}
        <div class="p-actions">
          <button class="btn btn-outline" data-act="add"${p.qty ? '' : ' disabled'}>${te('detail.addCart')}</button>
          <button class="btn" data-act="buy"${p.qty ? '' : ' disabled'}>${te('card.buy')}</button>
        </div>
      </div>
    </div>
    ${reviewsHtml(p, currentUser())}`;
  return true;
}

function openDetail(id, focusReview = false) {
  detailReviewOnly = focusReview;
  if (!renderDetail(id)) return;
  if (!$('detail-dialog').open) $('detail-dialog').showModal();
  const form = $('review-form');
  if (focusReview && form) form.scrollIntoView({ block: 'center' });
}

// Submit / update / delete a review (inside the detail dialog)
$('detail-body').addEventListener('submit', (e) => {
  if (e.target.id !== 'review-form') return;
  e.preventDefault();
  const user = currentUser();
  const id = e.target.dataset.id;
  const p = getProducts().find((x) => x.id === id);
  if (!p || user.role !== 'customer') return;
  const hadReview = getReviews().some((r) => r.productId === id && r.customerId === user.id);
  if (purchaseState(user.id, id) !== 'delivered' && !hadReview) return msgTo('review-msg', t('rev.hintOrdered'), 'error');
  const rating = parseInt(e.target.elements.rating.value, 10);
  if (!(rating >= 1 && rating <= 5)) return msgTo('review-msg', t('rev.chooseStars'), 'error');
  const comment = e.target.elements.comment.value.trim().slice(0, 500);

  const reviews = getReviews();
  const mine = reviews.find((r) => r.productId === id && r.customerId === user.id);
  if (mine) Object.assign(mine, { rating, comment, productName: p.name, updated: Date.now() });
  else reviews.push({ id: uid(), productId: id, productName: p.name, ownerId: p.ownerId, customerId: user.id, customerName: user.name, rating, comment, created: Date.now() });
  save(KEY.reviews, reviews);
  toast(t(mine ? 'rev.updated' : 'rev.thanks'));
  renderDetail(id);
  renderCustomer(user);
});

$('detail-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="del-review"]');
  if (!b) return;
  const user = currentUser();
  const id = b.closest('.reviews').dataset.id;
  if (!confirm(t('rev.confirmDelete'))) return;
  save(KEY.reviews, getReviews().filter((r) => !(r.productId === id && r.customerId === user.id)));
  toast(t('rev.deleted'));
  renderDetail(id);
  renderCustomer(user);
});

$('c-orders').addEventListener('click', (e) => {
  const b = e.target.closest('[data-review-product]');
  if (b) openDetail(b.dataset.reviewProduct, true);
});

// ---------- Customer: cart & checkout ----------
function renderCart() {
  const user = currentUser();
  const lines = cartLines();
  setCart(lines.map(({ p, qty }) => ({ id: p.id, qty })));   // drop lines that are no longer available
  updateCartCount();
  const keep = $('cart-address');
  const address = keep ? keep.value : (user.address || '');

  if (!lines.length) {
    $('cart-body').innerHTML = `<p class="empty">${te('cart.empty')}</p>`;
    return;
  }
  const total = sumTotal(lines.map(({ p, qty }) => ({ total: lineTotal(priceOf(p), qty) })));
  $('cart-body').innerHTML = `
    <div class="cart-list">${lines.map(({ p, qty }) => {
      const img = productImages(p)[0];
      return `
      <div class="cart-line" data-id="${esc(p.id)}">
        <div class="cl-img">${img ? `<img src="${esc(img)}" alt="">` : esc(p.emoji || '📦')}</div>
        <div class="cl-info"><b>${esc(p.name)}</b><small>🏬 ${esc(p.store)}</small><small>${rs(priceOf(p))} ${te('card.perUnit')}</small></div>
        <select class="cart-qty" aria-label="${te('aria.qtyOf', { name: p.name })}">${qtyOptions(Math.min(MAX_QTY, p.qty), qty)}</select>
        <div class="cl-total">${rs(lineTotal(priceOf(p), qty))}</div>
        <button type="button" class="cart-remove" aria-label="${te('aria.removeFromCart', { name: p.name })}">✕</button>
      </div>`;
    }).join('')}</div>
    <div class="cart-total"><span>${te('card.totalAmount')}</span><strong>${rs(total)}</strong></div>
    <div class="cart-checkout">
      <label><span>${te('cart.address')}</span>
        <textarea id="cart-address" rows="3" maxlength="200" placeholder="${te('ph.address')}" autocomplete="street-address">${esc(address)}</textarea>
      </label>
      <p class="form-msg" id="cart-msg" role="status"></p>
      <button type="button" class="btn btn-block" id="place-order">${te('cart.place')}</button>
    </div>`;
}

function openCart() {
  renderCart();
  if (!$('cart-dialog').open) $('cart-dialog').showModal();
}

function placeOrder() {
  const user = currentUser();
  const address = $('cart-address').value.trim();
  const lines = cartLines();
  if (!lines.length) return;
  if (address.length < 5) return msgTo('cart-msg', t('cart.addrReq'), 'error');

  const products = getProducts();
  for (const { p, qty } of lines) {
    const fresh = products.find((x) => x.id === p.id);
    if (!fresh || fresh.qty < qty) {
      renderCart();
      return msgTo('cart-msg', t('cart.noStock', { name: p.name }), 'error');
    }
  }

  // One order per wholesaler, so each can confirm and ship its own items
  const byOwner = new Map();
  lines.forEach(({ p, qty }) => {
    products.find((x) => x.id === p.id).qty -= qty;
    const item = { productId: p.id, name: p.name, store: p.store, price: priceOf(p), qty, total: lineTotal(priceOf(p), qty) };
    if (!byOwner.has(p.ownerId)) byOwner.set(p.ownerId, []);
    byOwner.get(p.ownerId).push(item);
  });

  const orders = getOrders();
  const now = Date.now();
  let grand = 0;
  byOwner.forEach((items, ownerId) => {
    const total = sumTotal(items);
    grand += total;
    orders.push({
      id: uid(), customerId: user.id, customerName: user.name, customerMobile: user.mobile || '', ownerId,
      store: [...new Set(items.map((i) => i.store))].join(', '), items, total, address, status: 'Pending', date: now,
    });
  });

  try { save(KEY.orders, orders); save(KEY.products, products); }
  catch { return msgTo('cart-msg', t('cart.full'), 'error'); }

  const users = getUsers();
  users.find((u) => u.id === user.id).address = address;   // remember it for next time
  save(KEY.users, users);
  setCart([]);
  $('cart-dialog').close();
  toast(t('cart.placed', { total: rs(Math.round(grand * 100) / 100) }));
  renderCustomer(currentUser());
}

$('cart-btn').addEventListener('click', openCart);
$('cart-body').addEventListener('change', (e) => {
  if (!e.target.classList.contains('cart-qty')) return;
  const id = e.target.closest('.cart-line').dataset.id;
  const cart = getCart();
  const line = cart.find((l) => l.id === id);
  if (line) { line.qty = parseInt(e.target.value, 10); setCart(cart); }
  renderCart();
});
$('cart-body').addEventListener('click', (e) => {
  if (e.target.closest('.cart-remove')) {
    const id = e.target.closest('.cart-line').dataset.id;
    setCart(getCart().filter((l) => l.id !== id));
    return renderCart();
  }
  if (e.target.closest('#place-order')) placeOrder();
});

// ---------- Customer: receipt ----------
let receiptId = null;

$('c-orders').addEventListener('click', (e) => {
  const b = e.target.closest('[data-receipt]');
  if (b) openReceipt(b.dataset.receipt);
});

function openReceipt(id) {
  const user = currentUser();
  const o = getOrders().find((x) => x.id === id && x.customerId === user.id);
  if (!o) return;
  receiptId = id;
  $('receipt-body').innerHTML = `
    <div class="receipt">
      <div class="r-head">
        <div><h2>Wholesale Market</h2><p>${te('rc.invoice')}</p></div>
        <div class="r-meta"><b>${te('order.num', { code: orderCode(o) })}</b><br>${esc(fmtDate(o.date))}</div>
      </div>
      <div class="r-parties">
        <div><h4>${te('rc.billed')}</h4>${esc(customerName(o))}<br>${esc(customerMobile(o))}<br>${o.address ? esc(o.address) : '—'}</div>
        <div><h4>${te('rc.sold')}</h4>${esc(o.store)}</div>
      </div>
      <table>
        <thead><tr><th>${te('rc.item')}</th><th>${te('rc.price')}</th><th>${te('rc.qty')}</th><th>${te('rc.amount')}</th></tr></thead>
        <tbody>${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${rs(i.price)}</td><td>${i.qty}</td><td class="num">${rs(i.total)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="r-total">${te('rc.total', { total: rs(o.total) })}</div>
      <p class="r-note">${te('rc.note', { status: statusLabel(o.status) })}</p>
    </div>`;
  if (!$('receipt-dialog').open) $('receipt-dialog').showModal();
}
$('print-btn').addEventListener('click', () => window.print());

// ---------- Profile ----------
function renderProfile(user) {
  const f = $('profile-form').elements;
  f.name.value = user.name || '';
  f.email.value = user.email || '';
  f.mobile.value = user.mobile || '';
  f.store.value = user.store || '';
  f.address.value = user.address || '';
  $('profile-store-label').hidden = user.role !== 'wholesaler';
  f.store.required = user.role === 'wholesaler';
  msgTo('profile-msg', '');
  msgTo('password-msg', '');
  $('password-form').reset();
}

$('profile-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = $('profile-form').elements;
  const users = getUsers();
  const me = users.find((u) => u.id === currentUser().id);
  const name = f.name.value.trim();
  const mobile = normMobile(f.mobile.value);
  const store = f.store.value.trim();
  if (!name) return msgTo('profile-msg', t('err.name'), 'error');
  if (!validMobile(mobile)) return msgTo('profile-msg', t('err.mobileInvalid'), 'error');
  if (users.some((u) => u.id !== me.id && u.mobile === mobile)) return msgTo('profile-msg', t('err.mobileTaken'), 'error');
  if (me.role === 'wholesaler' && !store) return msgTo('profile-msg', t('err.storeReq'), 'error');

  me.name = name;
  me.mobile = mobile;
  me.address = f.address.value.trim();
  if (me.role === 'wholesaler') me.store = store;
  save(KEY.users, users);
  renderChip(me);
  msgTo('profile-msg', t('p.saved'), 'ok');
  toast(t('toast.profileSaved'));
});

$('password-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = $('password-form').elements;
  const users = getUsers();
  const me = users.find((u) => u.id === currentUser().id);
  if (f.current.value !== me.password) return msgTo('password-msg', t('p.currentWrong'), 'error');
  if (f.newpass.value.length < 4) return msgTo('password-msg', t('p.newShort'), 'error');
  if (f.newpass.value !== f.newpass2.value) return msgTo('password-msg', t('p.newMismatch'), 'error');
  me.password = f.newpass.value;
  save(KEY.users, users);
  $('password-form').reset();
  msgTo('password-msg', t('p.pwUpdated'), 'ok');
  toast(t('toast.pwUpdated'));
});

// ---------- Dialog helpers ----------
document.addEventListener('click', (e) => {
  const x = e.target.closest('[data-close]');
  if (x) x.closest('dialog').close();
});
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

// ---------- Keep tabs in sync ----------
// Each tab has its own login, but products / orders / language are shared. When another tab changes them
// (a customer orders, a wholesaler changes stock, someone switches language), refresh what this tab is showing.
window.addEventListener('storage', (e) => {
  if (e.key === KEY.lang) { setLang(e.newValue, false); return; }
  if (![KEY.products, KEY.orders, KEY.users, KEY.reviews].includes(e.key)) return;
  if (page === 'profile') return;
  refreshView();
});

// ---------- Init ----------
try { localStorage.removeItem(KEY.session); } catch { /* older versions kept the login here */ }
let savedTheme = null;
let savedLang = null;
try { savedTheme = localStorage.getItem(KEY.theme); savedLang = localStorage.getItem(KEY.lang); } catch { /* ignore */ }
currentLang = savedLang === 'hi' ? 'hi' : 'en';   // English unless the visitor chose Hindi
applyTheme(savedTheme === 'light' ? 'light' : 'dark');
seed();
fillCatSelects();
fillSubjectSelect();
applyStaticText();
setMode('login');
updateChannelText();
renderResendBtn();
route();
