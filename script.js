// Wholesale Market – the website. Every piece of data lives on the server (PostgreSQL) and is reached through /api;
// this page keeps a copy of it in `state` only to draw the screens. Needs i18n.js (translations, t(), tp()) loaded first.
const MAX_PRICE = 1000000;
const priceOf = (p) => p.price;
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
const CATEGORIES = ['Toys', 'Stationery', 'Other'];   // stored in English, shown translated
const STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered'];          // stored in English, shown translated (the normal order flow)
const CLOSED = ['Cancelled', 'Refused'];                                    // an order that ends early; it can no longer change
const ALL_STATUSES = [...STATUSES, ...CLOSED];
const isClosed = (s) => CLOSED.includes(s);
const PAYMENTS = ['UPI', 'COD'];
const KEY = { theme: 'ws_theme', lang: 'ws_lang' };   // only this browser's preferences; the cart and wishlist have their own keys

const $ = (id) => document.getElementById(id);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const te = (key, vars) => esc(t(key, vars));   // translated text that is safe to put inside innerHTML
const money = (n) => n.toLocaleString();
const rs = (n) => `Rs ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;   // Indian Rupees
const categoryOf = (p) => (CATEGORIES.includes(p.category) ? p.category : 'Other');
const catLabel = (c) => t(`cat.${CATEGORIES.includes(c) ? c : 'Other'}`);
const statusLabel = (s) => t(`status.${s}`);
const productImages = (p) => p.images || [];
const orderCode = (o) => o.code;
const sumTotal = (items) => Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100;
const unitsOf = (o) => o.items.reduce((s, i) => s + i.qty, 0);

// Delivery / COD / UPI rules: the admin sets them, the server enforces them. An empty PIN list means "deliver everywhere".
const DEFAULT_SETTINGS = { codMin: 5000, pincodes: [], upiId: 'test@upi', upiName: 'Wholesale Market' };

// What the server told us the last time we asked (see refreshData). `me` is the logged-in person, or null.
const state = { me: null, products: [], wholesalers: [], orders: [], reviews: [], settings: { ...DEFAULT_SETTINGS } };
const getProducts = () => state.products;
const getOrders = () => state.orders;
const getWholesalers = () => state.wholesalers;   // only the admin gets this list
const getReviews = () => state.reviews;
const getSettings = () => state.settings;
const isAdmin = (u) => !!u && u.role === 'admin';
// UPI payment of an order: 'Unpaid' -> 'Submitted' (customer sent the UTR) -> 'Paid' (admin checked the money). COD orders have none.
const payStatusOf = (o) => (o.payment === 'UPI' ? (o.payStatus || 'Unpaid') : '');
// Orders placed together (one cart, several wholesalers) are paid with one UPI payment
const groupOrders = (o, list = getOrders()) => (o.group ? list.filter((x) => x.group === o.group) : [o]);
const payText = (o) => (o.payment === 'UPI' ? `${t('pay.upi')} – ${t(`pay.st.${payStatusOf(o)}`)}` : t(`pay.${String(o.payment).toLowerCase()}`));

const pincodeAllowed = (pin) => { const list = getSettings().pincodes; return !list.length || list.includes(pin); };
// Why COD is not allowed for this amount ('' when it is allowed). The server checks the same rule again when the order is placed.
function codBlockReason(user, total) {
  return total < getSettings().codMin ? 'min' : '';   // COD is only for bigger orders; small ones pay by UPI
}

const locale = () => (currentLang === 'hi' ? 'hi-IN' : 'en-IN');
const fmtDate = (ts) => new Date(ts).toLocaleString(locale());
const fmtDay = (ts) => new Date(ts).toLocaleDateString(locale());

const waNumber = (m) => { const d = String(m || '').replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d; };
const waLink = (mobile, text) => (waNumber(mobile).length >= 10 ? `https://wa.me/${waNumber(mobile)}?text=${encodeURIComponent(text)}` : '');

function msgTo(id, text, kind) { const el = $(id); if (!el) return; el.textContent = text; el.className = 'form-msg' + (kind ? ' ' + kind : ''); }

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
  [['detail-dialog', 'detail.title'], ['cart-dialog', 'cart.title'], ['edit-dialog', 'edit.title'], ['receipt-dialog', 'rc.title'], ['order-dialog', 'od.title'], ['pay-dialog', 'pay.title']]
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

function fillWhSelects() {
  const list = getWholesalers();
  document.querySelectorAll('.wh-select').forEach((sel) => {
    const prev = sel.value;
    sel.innerHTML = list.map((w) => `<option value="${esc(w.id)}">${esc(w.store)}</option>`).join('');
    if (prev && list.some((w) => w.id === prev)) sel.value = prev;
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
  fillWhSelects();
  fillSubjectSelect();
  document.querySelectorAll('.form-msg').forEach((el) => { el.textContent = ''; el.className = 'form-msg'; });   // old messages would stay in the old language
  setMode(mode);
  updateChannelText();
  renderOtpTexts();
  renderResendBtn();
  refreshView();
}
$('lang-select').addEventListener('change', (e) => setLang(e.target.value));

// ---------- Talking to the server ----------
class ApiError extends Error {
  constructor(status, code, message, field, meta) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    this.meta = meta;
  }
}

async function api(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET' && method !== 'DELETE') {
    init.headers['Content-Type'] = 'application/json';   // the server only accepts JSON for changes (this also blocks forged forms)
    init.body = JSON.stringify(body ?? {});
  }
  let res;
  try { res = await fetch(`/api${path}`, init); }
  catch { throw new ApiError(0, 'NETWORK', 'Cannot reach the server.'); }
  let data = null;
  try { data = await res.json(); } catch { /* an empty or non-JSON answer */ }
  if (!res.ok) throw new ApiError(res.status, (data && data.code) || 'SERVER_ERROR', (data && data.error) || '', data && data.field, data && data.meta);
  return data;
}

// The text for an error, in the visitor's language (the server's English message is the fallback)
function apiText(err, vars) {
  const key = `api.${err.code}`;
  const text = t(key, { ...(err.meta || {}), ...(vars || {}) });
  return text !== key ? text : (err.message || t('api.SERVER_ERROR'));
}

// Shows an error next to a form (msgId) or as a toast. An ended login sends the visitor back to the login page.
function showApiError(err, msgId, vars) {
  if (err.code === 'LOGIN_REQUIRED' && state.me) return sessionExpired();
  if (msgId) msgTo(msgId, apiText(err, vars), 'error'); else toast(apiText(err, vars));
}

// Keeps a button switched off while its request runs, so a double click cannot send the same thing twice
async function busy(button, fn) {
  if (button) button.disabled = true;
  try { return await fn(); } finally { if (button) button.disabled = false; }
}

// Asks the server for everything this person may see. Returns true when something changed since the last time.
let lastSnapshot = '';
async function refreshData() {
  const [products, settings, reviews] = await Promise.all([api('GET', '/products'), api('GET', '/settings'), api('GET', '/reviews')]);
  state.products = products;
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  state.reviews = reviews;
  state.orders = state.me ? await api('GET', '/orders') : [];
  state.wholesalers = isAdmin(state.me) ? await api('GET', '/wholesalers') : [];
  const snapshot = JSON.stringify([state.products, state.settings, state.reviews, state.orders, state.wholesalers]);
  const changed = snapshot !== lastSnapshot;
  lastSnapshot = snapshot;
  return changed;
}

function forgetData() {
  state.me = null;
  state.products = []; state.wholesalers = []; state.orders = []; state.reviews = [];
  lastSnapshot = '';
}

function sessionExpired() {
  forgetData();
  page = 'home';
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  route();
  toast(t('api.LOGIN_REQUIRED'));
}

// The page asks the server again every 20 seconds and when the tab comes back, so new orders and stock changes show up by themselves
let syncing = false;
async function syncFromServer() {
  if (syncing || !state.me || document.hidden) return;
  syncing = true;
  try {
    if (await refreshData()) refreshView();   // redraw only when something really changed, so typed quantities are not wiped
  } catch (err) {
    if (err.code === 'LOGIN_REQUIRED') sessionExpired();
  } finally {
    syncing = false;
  }
}

// ---------- Session / routing ----------
const currentUser = () => state.me;   // the login itself is a cookie that only the server can read
let page = 'home';   // 'home' (landing or role dashboard), 'profile' or 'help'

function show(view) {
  ['auth-view', 'admin-view', 'customer-view', 'profile-view', 'help-view'].forEach((v) => ($(v).hidden = v !== view));
}

function renderChip(user) {
  $('user-chip').textContent = isAdmin(user) ? `🛠️ ${user.name}` : `🛒 ${user.name}`;
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
  else if (isAdmin(user)) { show('admin-view'); renderAdmin(); }
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
    if (isAdmin(user)) renderAdmin(); else renderCustomer(user);
  }
  if ($('detail-dialog').open && detailId) renderDetail(detailId);
  if ($('cart-dialog').open && user) renderCart();
  if ($('receipt-dialog').open && receiptId) openReceipt(receiptId);
  if ($('order-dialog').open && orderDialogId) renderOrderDialog(orderDialogId);
  if ($('pay-dialog').open && payOrderId && !renderPay(payOrderId)) $('pay-dialog').close();
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

// Quantity boxes: the customer types a number; it is kept between 1 and what can be bought
function qtyValue(input) {
  const max = Number(input.max) || MAX_QTY;
  const n = parseInt(input.value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : 1;
}

// ---------- Wishlist & cart (stored per user) ----------
const userKey = (prefix) => `${prefix}_${state.me ? state.me.id : ''}`;
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
  // Downscale, so the upload stays small
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
  document.querySelectorAll('.reg-only').forEach((el) => {
    el.hidden = mode !== 'register';
    el.querySelector('input').required = !el.hidden;   // every visible register field is mandatory
  });
  authForm.classList.toggle('register', mode === 'register');
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
$('cta-register').addEventListener('click', () => {
  if (!resetBox.hidden) closeReset();
  setMode('register');
});

function authError(msg) { authMsg.textContent = msg; authMsg.className = 'form-msg error'; }

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = authForm.elements;
  const email = f.email.value.trim().toLowerCase();
  const password = f.password.value;

  if (!validEmail(email)) return authError(t('err.email'));
  if (password.length < 6) return authError(t('err.pass6'));

  let body = { email, password };
  if (mode === 'register') {
    const name = f.name.value.trim();
    const mobile = normMobile(f.mobile.value);
    if (!name) return authError(t('err.name'));
    if (!f.confirm.value) return authError(t('err.confirmReq'));
    if (f.confirm.value !== password) return authError(t('err.pwMismatch'));
    if (!f.mobile.value.trim()) return authError(t('err.mobileReq'));
    if (!validMobile(mobile)) return authError(t('err.mobileInvalid'));
    body = { name, email, mobile, password };
  }

  await busy($('auth-submit'), async () => {
    try {
      state.me = (await api('POST', mode === 'login' ? '/auth/login' : '/auth/register', body)).user;
    } catch (err) {
      return authError(apiText(err));
    }
    try {
      await refreshData();
    } catch (err) {
      forgetData();
      api('POST', '/auth/logout', {}).catch(() => {});
      return authError(apiText(err));
    }
    authForm.reset();
    setMode('login');
    page = 'home';
    route();
  });
});

// ---------- Forgot password (a code by email or mobile) ----------
// The server makes and checks the code. Until a real SMS / email service is connected, the server (with DEMO_OTP=true, for local
// testing only) sends the code back so it can be shown on screen. Without it the request answers "not set up yet".
const RESEND_WAIT_S = 30;

const resetBox = $('reset-box');
const reqForm = $('reset-request');
const verForm = $('reset-verify');
let otpState = null;   // { channel, identifier, sentTo, demoOtp }
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
  $('otp-sent-to').textContent = t('reset.sentTo', { target: otpState.sentTo });
  const demo = $('demo-otp');
  demo.hidden = !otpState.demoOtp;
  if (otpState.demoOtp) demo.innerHTML = t(otpState.channel === 'email' ? 'reset.demoEmail' : 'reset.demoSms', { otp: otpState.demoOtp });
}

async function requestOtp(channel, identifier, msgId) {
  try {
    const r = await api('POST', '/auth/reset/request', { channel, identifier });
    otpState = { channel, identifier, sentTo: r.sentTo, demoOtp: r.demoOtp || '' };
    renderOtpTexts();
    startResendCooldown();
    return true;
  } catch (err) {
    msgTo(msgId, apiText(err), 'error');
    return false;
  }
}

$('forgot-link').addEventListener('click', openReset);
resetBox.querySelectorAll('.reset-back').forEach((b) => b.addEventListener('click', closeReset));
reqForm.querySelectorAll('input[name="channel"]').forEach((r) => r.addEventListener('change', syncChannel));

reqForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const channel = reqForm.elements.channel.value;
  const raw = reqForm.elements.identifier.value.trim();
  if (channel === 'email') {
    if (!validEmail(raw)) return msgTo('reset-msg1', t('err.email'), 'error');
  } else if (!validMobile(normMobile(raw))) {
    return msgTo('reset-msg1', t('reset.invalidMobile'), 'error');
  }
  await busy(e.submitter, async () => {
    if (!(await requestOtp(channel, raw, 'reset-msg1'))) return;
    reqForm.hidden = true;
    verForm.hidden = false;
    verForm.reset();
    msgTo('reset-msg2', '');
  });
});

$('resend-otp').addEventListener('click', async () => {
  if (!otpState) return;
  if (await requestOtp(otpState.channel, otpState.identifier, 'reset-msg2')) {
    verForm.elements.otp.value = '';
    msgTo('reset-msg2', t('reset.newSent'), 'ok');
  }
});

verForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = verForm.elements;
  if (!otpState) return msgTo('reset-msg2', t('reset.reqFirst'), 'error');
  if (!/^\d{6}$/.test(f.otp.value.trim())) return msgTo('reset-msg2', t('reset.otp6'), 'error');
  if (f.newpass.value.length < 6) return msgTo('reset-msg2', t('err.pass6'), 'error');
  if (f.newpass.value !== f.newpass2.value) return msgTo('reset-msg2', t('err.pwMismatch'), 'error');

  await busy(e.submitter, async () => {
    try {
      await api('POST', '/auth/reset/verify', { channel: otpState.channel, identifier: otpState.identifier, otp: f.otp.value.trim(), newPassword: f.newpass.value });
    } catch (err) {
      if (err.code === 'OTP_EXPIRED' || err.code === 'OTP_TOO_MANY') otpState = null;
      return msgTo('reset-msg2', apiText(err), 'error');
    }
    closeReset();
    authMsg.textContent = t('reset.done');
    authMsg.className = 'form-msg ok';
  });
});

$('logout-btn').addEventListener('click', async () => {
  try { await api('POST', '/auth/logout', {}); } catch { /* the cookie is cleared on the next visit anyway */ }
  forgetData();
  page = 'home';
  $('contact-form').reset();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
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
const FAQ_GROUPS = [['faq.g.customers', [1, 2, 3, 4, 5, 6]], ['faq.g.account', [11, 12]]];

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

$('contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const name = f.name.value.trim();
  const email = f.email.value.trim();
  const message = f.message.value.trim();
  if (!name) return msgTo('contact-msg', t('err.name'), 'error');
  if (!validEmail(email)) return msgTo('contact-msg', t('err.email'), 'error');
  if (message.length < 10) return msgTo('contact-msg', t('contact.errMsg'), 'error');

  await busy(e.submitter, async () => {
    try {
      const r = await api('POST', '/contact', { name, email, subject: f.subject.value, message });
      f.message.value = '';
      msgTo('contact-msg', t('contact.sent', { ref: r.ref }), 'ok');
    } catch (err) {
      showApiError(err, 'contact-msg');
    }
  });
});

// ---------- Shared product-form checks (add form and edit dialog) ----------
// The server checks everything again (and decides about duplicates); this only gives quick feedback.
function parseProductForm(f, minQty) {
  const name = f.pname.value.trim();
  if (!name) return { error: t('msg.prodNameStore') };
  const wholesaler = getWholesalers().find((w) => w.id === f.pwholesaler.value);
  if (!wholesaler) return { error: t('wh.pick') };

  const qty = parseQty(f.pqty.value, minQty);
  if (qty === null) return { error: t('msg.qtyRange', { min: minQty, max: money(MAX_STOCK) }) };
  const price = parsePrice(f.pprice.value);
  if (price === null) return { error: t('msg.priceRange', { max: rs(MAX_PRICE) }) };

  const category = CATEGORIES.includes(f.pcat.value) ? f.pcat.value : 'Other';
  const description = f.pdesc.value.trim().slice(0, 300);
  return { data: { wholesalerId: wholesaler.id, name, category, description, price, qty } };
}

// ---------- Admin panel ----------
const productForm = $('product-form');
let adminTab = 'orders';   // which admin page is showing
function showAdminTab(tab) {
  adminTab = tab;
  document.querySelectorAll('#admin-tabs .atab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  document.querySelectorAll('.admin-tab').forEach((s) => { s.hidden = s.dataset.tab !== tab; });
}
$('admin-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.atab');
  if (b) showAdminTab(b.dataset.tab);
});
// A UPI order reaches the admin only after the customer has paid (or sent the UTR); before that it is just a hold on the stock
const adminVisible = (o) => o.payment !== 'UPI' || payStatusOf(o) !== 'Unpaid' || !!o.paySubmitted;
// A paid order that got cancelled: the admin still owes the customer the money
const refundDue = (o) => isClosed(o.status) && ['Paid', 'Submitted'].includes(payStatusOf(o));
const allOrders = () => getOrders().filter(adminVisible).sort((a, b) => b.date - a.date);
const customerName = (o) => o.customerName || 'Customer';
const customerMobile = (o) => o.customerMobile || '';

// WhatsApp texts are English on purpose: they go to outside people, whatever language the admin panel is in.
// Customer: a "successful" invoice once the order is paid (otherwise a plain confirmation). Wholesaler: the item list and how it is paid.
function waMessages(o) {
  const w = getWholesalers().find((x) => x.id === o.ownerId);
  const code = orderCode(o);
  const lines = o.items.map((i) => `- ${i.name} x ${i.qty} (${rs(i.price)} each) = ${rs(i.total)}`).join(String.fromCharCode(10));
  const paid = payStatusOf(o) === 'Paid';
  const addr = `${o.address || '-'}${o.pincode ? ` - ${o.pincode}` : ''}`;
  const how = paid ? 'PAID by UPI' : o.payment === 'COD' ? `COD: collect ${rs(o.total)} on delivery` : 'UPI payment pending';
  const toCustomer = paid
    ? `Hello ${customerName(o)}, your order #${code} is successful ✅

Invoice:
${lines}
Total paid: ${rs(o.total)}${o.payRef ? ` (UPI ref ${o.payRef})` : ''}

Delivery address: ${addr}
Thank you for shopping with Wholesale Market.`
    : `Hello ${customerName(o)}, we received your order #${code}.
${lines}
Total: ${rs(o.total)}${o.payment === 'COD' ? ' (pay on delivery)' : ''}
Delivery address: ${addr}
Please reply YES to confirm.`;
  return {
    wholesaler: w ? waLink(w.mobile, `Hello ${w.name}, new order #${code} from Wholesale Market (${how}):
${lines}
Total: ${rs(o.total)}
Please confirm the stock and keep it ready for pickup.`) : '',
    customer: waLink(customerMobile(o), toCustomer),
  };
}

function waButton(href, labelKey) {
  return href
    ? `<a class="btn btn-outline btn-small wa-btn" href="${esc(href)}" target="_blank" rel="noopener">${te(labelKey)}</a>`
    : `<span class="btn btn-outline btn-small wa-btn" aria-disabled="true">${te(labelKey)}</span>`;
}

function renderAdmin() {
  showAdminTab(adminTab);
  fillWhSelects();
  const wholesalers = getWholesalers();
  const mine = getProducts();
  const products = mine.filter((p) => matchesSearch(p, $('w-search').value));
  const orders = allOrders();
  const units = orders.reduce((s, o) => s + unitsOf(o), 0);
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const stock = mine.reduce((s, p) => s + p.qty, 0);
  const idx = reviewIndex();
  const sellerStat = [...idx.byProduct.values()].reduce((a, v) => ({ sum: a.sum + v.sum, count: a.count + v.count }), { sum: 0, count: 0 });

  $('w-stats').innerHTML = `
    <div class="stat"><strong>${mine.length}</strong><span>${te('stat.products')}</span></div>
    <div class="stat"><strong>${stock}</strong><span>${te('stat.stock')}</span></div>
    <div class="stat"><strong>${units}</strong><span>${te('stat.sold')}</span></div>
    <div class="stat"><strong>${rs(revenue)}</strong><span>${te('stat.sales')}</span></div>
    <div class="stat"><strong>${sellerStat.count ? `${avgOf(sellerStat).toFixed(1)} ★` : '—'}</strong><span>${sellerStat.count ? (sellerStat.count === 1 ? te('stat.ratingOne') : te('stat.ratingMany', { n: sellerStat.count })) : te('stat.noReviews')}</span></div>
    <div class="stat"><strong>${wholesalers.length}</strong><span>${te('stat.wholesalers')}</span></div>`;

  const myReviews = getReviews().filter((r) => idx.byProduct.has(r.productId))
    .sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  $('w-reviews').innerHTML = myReviews.length ? `<div class="rev-list">${myReviews.map((r) => `
    <article class="rev">
      <div class="rev-head"><span class="stars" aria-hidden="true">${starText(r.rating)}</span><b>${esc(r.productName || '—')}</b><small>${te('by', { name: r.customerName })} · ${esc(fmtDay(r.updated || r.created))}</small></div>
      <span class="sr-only">${te('rev.srStars', { n: r.rating })}</span>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
    </article>`).join('')}</div>` : `<p class="empty">${te('w.noReviews')}</p>`;

  renderWholesalerList(wholesalers);
  renderRules();

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

  // Red alert on top while there are cancelled orders that still have to be refunded
  const due = orders.filter(refundDue);
  $('w-alerts').innerHTML = due.length ? `<div class="alert-box" role="alert"><b>⚠ ${te('od.refundsDue', { n: due.length })}</b><ul>${due.map((o) => `
    <li data-id="${esc(o.id)}"><span>#${esc(orderCode(o))} · ${esc(customerName(o))} · ${rs(o.total)}${o.cancelledBy === 'customer' ? ` · ${te('od.cancelledByCustomerShort')}` : ''}</span> <button type="button" class="btn btn-outline btn-small view-order">${te('od.view')}</button></li>`).join('')}</ul></div>` : '';

  // The list stays short (who, how much, status); everything about one order opens in the "View" dialog
  $('w-orders').innerHTML = orders.length ? `
    <div class="table-wrap"><table>
      <thead><tr><th>${te('th.date')}</th><th>${te('th.order')}</th><th>${te('th.customer')}</th><th>${te('th.total')}</th><th>${te('th.payment')}</th><th>${te('th.status')}</th><th></th></tr></thead>
      <tbody>${orders.map((o) => `
        <tr data-id="${esc(o.id)}"${o.cancelledBy === 'customer' ? ' class="cancelled-row"' : ''}>
          <td>${esc(fmtDate(o.date))}</td>
          <td>#${esc(orderCode(o))}<small>${esc(o.store)}</small></td>
          <td>${esc(customerName(o))}<small>${esc(customerMobile(o))}</small></td>
          <td class="num">${rs(o.total)}</td>
          <td>${o.payment ? `<b>${esc(o.payment)}</b>${payStatusOf(o) ? `<small>${te(`pay.st.${payStatusOf(o)}`)}</small>` : ''}` : '—'}</td>
          <td>${statusSelect(o, '')}${o.cancelledBy === 'customer' ? `<small class="cancel-by">${te('od.cancelledByCustomerShort')}</small>` : ''}${refundDue(o) ? `<small class="od-warn">${te('od.refundDueShort')}</small>` : ''}</td>
          <td><button type="button" class="btn btn-outline btn-small view-order">${te('od.view')}</button></td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : `<p class="empty">${te('w.noOrders')}</p>`;
}

function statusSelect(o, extraClass) {
  return `<select class="status-select ${extraClass}"${isClosed(o.status) ? ' disabled' : ''} aria-label="${te('aria.statusOf', { code: orderCode(o) })}">${ALL_STATUSES.map((s) => `<option value="${s}"${s === o.status ? ' selected' : ''}>${te(`status.${s}`)}</option>`).join('')}</select>`;
}

// One order in full: customer, wholesaler, items and the WhatsApp buttons
let orderDialogId = null;

function renderOrderDialog(id) {
  const o = getOrders().find((x) => x.id === id);
  if (!o) { orderDialogId = null; return false; }
  orderDialogId = id;
  const w = getWholesalers().find((x) => x.id === o.ownerId);
  const wa = waMessages(o);
  $('order-body').innerHTML = `
    <div class="od-grid">
      <section class="od-box">
        <h4>${te('od.customer')}</h4>
        <b>${esc(customerName(o))}</b>
        <span>📞 ${customerMobile(o) ? esc(customerMobile(o)) : '—'}</span>
        <span>📍 ${o.address ? esc(o.address) : te('w.noAddress')}${o.pincode ? ` – ${esc(o.pincode)}` : ''}</span>
      </section>
      <section class="od-box">
        <h4>${te('od.wholesaler')}</h4>
        <b>${esc(o.store)}</b>
        ${w ? `<span>${esc(w.name)}</span><span>📞 ${esc(w.mobile)}</span>${w.address ? `<span>📍 ${esc(w.address)}</span>` : ''}` : ''}
      </section>
      <section class="od-box">
        <h4>${te('od.order')}</h4>
        <b>#${esc(orderCode(o))}</b>
        <span>${esc(fmtDate(o.date))}</span>
        <span>${te('th.payment')}: <b>${o.payment ? esc(o.payment) : '—'}</b></span>
        ${o.payment === 'UPI' ? payAdminHtml(o) : ''}
        ${statusSelect(o, 'od-status')}
      </section>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>${te('rc.item')}</th><th>${te('rc.price')}</th><th>${te('rc.qty')}</th><th>${te('rc.amount')}</th></tr></thead>
      <tbody>${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${rs(i.price)}</td><td>${i.qty}</td><td class="num">${rs(i.total)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="od-total"><span>${te('th.total')}</span><strong>${rs(o.total)}</strong></div>
    <div class="od-actions">${waButton(wa.wholesaler, 'wa.wholesaler')}${waButton(wa.customer, 'wa.customer')}</div>`;
  return true;
}

// UPI payment box inside the order dialog: status, UTR and the "mark as paid" button (it covers every order paid together)
function payAdminHtml(o) {
  const st = payStatusOf(o);
  const grp = groupOrders(o);
  return `
    <span>${te('od.payStatus')}: <span class="badge pay-${st.toLowerCase()}">${te(`pay.st.${st}`)}</span></span>
    ${o.payRef ? `<span>UTR: <b>${esc(o.payRef)}</b></span>` : ''}
    ${grp.length > 1 ? `<small>${te('od.payTogether', { codes: grp.map((x) => `#${orderCode(x)}`).join(', ') })}</small>` : ''}
    ${o.cancelledBy === 'customer' ? `<span>${te('od.cancelledByCustomer')}</span>` : ''}
    ${isClosed(o.status) && (st === 'Paid' || st === 'Submitted') ? `<span class="od-warn">${te('od.refund', { amount: rs(o.total) })}</span>` : ''}
    <span>${payActionHtml(o, st)}</span>`;
}

// A closed order can only be set back to unpaid (after the refund); an open one is checked and marked paid, or set back to unpaid
function payActionHtml(o, st) {
  const paid = `<button type="button" class="btn btn-small" data-pay-act="Paid">${te('od.markPaid')}</button>`;
  const unpaid = `<button type="button" class="btn btn-outline btn-small" data-pay-act="Unpaid">${te('od.markUnpaid')}</button>`;
  if (isClosed(o.status)) return st === 'Unpaid' ? '' : unpaid;
  return st === 'Paid' ? unpaid : paid;
}

async function setPayStatus(id, status) {
  if (!isAdmin(currentUser())) return;
  const o = getOrders().find((x) => x.id === id);
  if (!o || o.payment !== 'UPI' || !['Paid', 'Unpaid'].includes(status)) return;
  let changed;
  try {
    changed = (await api('POST', `/orders/${id}/payment`, { status })).orders;   // the server also confirms a paid order and covers every order paid together
    await refreshData();
  } catch (err) {
    showApiError(err);
    return;
  }
  toast(t(status === 'Paid' ? 'od.markedPaid' : 'od.markedUnpaid', { n: changed.length }));
  renderAdmin();
  renderOrderDialog(id);
}

$('order-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pay-act]');
  if (b && orderDialogId) setPayStatus(orderDialogId, b.dataset.payAct);
});

function openOrder(id) {
  if (renderOrderDialog(id) && !$('order-dialog').open) $('order-dialog').showModal();
}

$('w-orders').addEventListener('click', (e) => {
  const b = e.target.closest('.view-order');
  if (b) openOrder(b.closest('tr').dataset.id);
});
$('w-alerts').addEventListener('click', (e) => {
  const b = e.target.closest('.view-order');
  if (b) openOrder(b.closest('li').dataset.id);
});
$('order-dialog').addEventListener('close', () => { orderDialogId = null; });

$('w-search').addEventListener('input', () => renderAdmin());

// COD & delivery rules
const rulesForm = $('rules-form');
let rulesDirty = false;   // true while the admin has typed changes that are not saved yet, so a redraw must not overwrite them
rulesForm.addEventListener('input', () => { rulesDirty = true; });

function renderRules() {
  const st = getSettings();
  if (!rulesDirty) {
    const f = rulesForm.elements;
    f.codMin.value = st.codMin;
    f.pincodes.value = st.pincodes.join(', ');
    f.upiId.value = st.upiId;
    f.upiName.value = st.upiName;
  }
}

rulesForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isAdmin(currentUser())) return;
  const f = rulesForm.elements;
  const minAmt = Number(f.codMin.value);
  if (f.codMin.value.trim() === '' || !Number.isFinite(minAmt) || minAmt < 0 || minAmt > MAX_PRICE) return msgTo('rules-msg', t('rules.errLimit'), 'error');
  const pins = [...new Set(f.pincodes.value.split(/[\s,;]+/).filter(Boolean))];
  if (pins.some((p) => !/^\d{6}$/.test(p))) return msgTo('rules-msg', t('rules.errPins'), 'error');
  const upiId = f.upiId.value.trim();
  if (!/^[\w.\-]{2,}@[A-Za-z][A-Za-z0-9]+$/.test(upiId)) return msgTo('rules-msg', t('rules.errUpi'), 'error');

  await busy(e.submitter, async () => {
    try {
      state.settings = { ...DEFAULT_SETTINGS, ...(await api('PUT', '/settings', { codMin: Math.round(minAmt), pincodes: pins, upiId, upiName: f.upiName.value.trim() })) };
    } catch (err) {
      return showApiError(err, 'rules-msg');
    }
    rulesDirty = false;
    msgTo('rules-msg', t('rules.saved'), 'ok');
    toast(t('rules.saved'));
    renderRules();
  });
});

// Wholesalers: add / edit / delete (the admin keeps this list; wholesalers do not log in)
const whForm = $('wholesaler-form');
let editingWh = null;

function renderWholesalerList(list) {
  const prodCount = new Map();
  getProducts().forEach((p) => prodCount.set(p.ownerId, (prodCount.get(p.ownerId) || 0) + 1));
  $('wh-list').innerHTML = list.length ? `
    <table>
      <thead><tr><th>${te('th.store')}</th><th>${te('th.contact')}</th><th>${te('th.whAddress')}</th><th>${te('th.products')}</th><th>${te('th.actions')}</th></tr></thead>
      <tbody>${list.map((w) => `
        <tr data-id="${esc(w.id)}">
          <td><b>${esc(w.store)}</b></td>
          <td>${esc(w.name)}<small>${esc(w.mobile)}</small></td>
          <td>${w.address ? esc(w.address) : '—'}</td>
          <td class="num">${prodCount.get(w.id) || 0}</td>
          <td><button type="button" class="btn btn-outline btn-small wh-edit">${te('card.edit')}</button> <button type="button" class="btn btn-danger btn-small wh-del">${te('card.delete')}</button></td>
        </tr>`).join('')}
      </tbody>
    </table>` : `<p class="empty">${te('wh.none')}</p>`;
}

function resetWhForm() {
  editingWh = null;
  whForm.reset();
  $('wh-submit').textContent = t('wh.add');
  $('wh-cancel').hidden = true;
}

whForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isAdmin(currentUser())) return;
  const f = whForm.elements;
  const store = f.wstore.value.trim();
  const name = f.wname.value.trim();
  const mobile = normMobile(f.wmobile.value);
  const address = f.waddr.value.trim();
  if (!store || !name) return msgTo('wh-msg', t('wh.errName'), 'error');
  if (!validMobile(mobile)) return msgTo('wh-msg', t('err.mobileInvalid'), 'error');

  await busy(e.submitter, async () => {
    const wasEditing = !!editingWh;
    try {
      if (editingWh) await api('PUT', `/wholesalers/${editingWh}`, { store, name, mobile, address });
      else await api('POST', '/wholesalers', { store, name, mobile, address });
      await refreshData();
    } catch (err) {
      return showApiError(err, 'wh-msg', { store });
    }
    toast(t(wasEditing ? 'wh.updated' : 'wh.added'));
    resetWhForm();
    msgTo('wh-msg', '');
    renderAdmin();
  });
});

$('wh-cancel').addEventListener('click', () => { resetWhForm(); msgTo('wh-msg', ''); });

$('wh-list').addEventListener('click', async (e) => {
  const row = e.target.closest('tr[data-id]');
  if (!row || !isAdmin(currentUser())) return;
  const w = getWholesalers().find((x) => x.id === row.dataset.id);
  if (!w) return;
  if (e.target.closest('.wh-edit')) {
    editingWh = w.id;
    const f = whForm.elements;
    f.wstore.value = w.store;
    f.wname.value = w.name;
    f.wmobile.value = w.mobile;
    f.waddr.value = w.address || '';
    $('wh-submit').textContent = t('wh.save');
    $('wh-cancel').hidden = false;
    msgTo('wh-msg', '');
    whForm.scrollIntoView({ block: 'center' });
    return;
  }
  if (!e.target.closest('.wh-del')) return;
  const n = getProducts().filter((p) => p.ownerId === w.id).length;
  if (!confirm(t('wh.confirmDelete', { n }))) return;
  try {
    await api('DELETE', `/wholesalers/${w.id}`);
    await refreshData();
  } catch (err) {
    return showApiError(err);
  }
  if (editingWh === w.id) resetWhForm();
  toast(t('wh.deleted'));
  renderAdmin();
});

async function saveQuick(card) {
  const price = parsePrice(card.querySelector('.price-input').value);
  if (price === null) { toast(t('msg.priceRange', { max: rs(MAX_PRICE) })); return; }
  const qty = parseQty(card.querySelector('.stock-input').value, 0);
  if (qty === null) { toast(t('msg.qtyRange', { min: 0, max: money(MAX_STOCK) })); return; }
  if (!isAdmin(currentUser())) return;
  try {
    await api('PATCH', `/products/${card.dataset.id}/stock`, { price, qty });
    await refreshData();
  } catch (err) {
    return showApiError(err);
  }
  toast(t('msg.productUpdated'));
  renderAdmin();
}

$('w-products').addEventListener('keydown', (e) => {
  const c = e.target.classList;
  if (e.key === 'Enter' && (c.contains('price-input') || c.contains('stock-input'))) { e.preventDefault(); saveQuick(e.target.closest('.product')); }
});

$('w-products').addEventListener('click', async (e) => {
  const card = e.target.closest('.product');
  if (!card) return;
  const cl = e.target.classList;
  if (cl.contains('save-price')) return saveQuick(card);
  if (cl.contains('edit-btn')) return openEdit(card.dataset.id);
  if (!cl.contains('del-btn')) return;
  if (!isAdmin(currentUser()) || !confirm(t('msg.confirmDelete'))) return;
  try {
    await api('DELETE', `/products/${card.dataset.id}`);
    await refreshData();
  } catch (err) {
    return showApiError(err);
  }
  toast(t('msg.productDeleted'));
  renderAdmin();
});

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isAdmin(currentUser())) return;
  const f = productForm.elements;
  const r = parseProductForm(f, 1);
  if (r.error) return msgTo('product-msg', r.error, 'error');

  const files = [...f.pimage.files];
  if (files.length > MAX_PHOTOS) return msgTo('product-msg', t('msg.maxPhotos', { n: MAX_PHOTOS }), 'error');
  const images = await Promise.all(files.map(readImage));
  if (images.includes(null)) return msgTo('product-msg', t('msg.badImage'), 'error');

  await busy(e.submitter, async () => {
    try {
      await api('POST', '/products', { ...r.data, images });
      await refreshData();
    } catch (err) {
      return showApiError(err, 'product-msg', { name: r.data.name });
    }
    const keepWholesaler = f.pwholesaler.value;   // the admin usually adds several products for one wholesaler in a row
    productForm.reset();
    f.pwholesaler.value = keepWholesaler;
    msgTo('product-msg', '');
    toast(t('msg.productAdded'));
    renderAdmin();
  });
});

// Admin: change order status (from the list or from the order dialog). Cancelled / Refused end the order:
// the server puts the goods back into stock and the order can no longer change.
async function changeOrderStatus(id, next) {
  const refresh = () => { renderAdmin(); if (orderDialogId === id) renderOrderDialog(id); };   // also puts a cancelled choice back
  if (!isAdmin(currentUser())) return;
  const o = getOrders().find((x) => x.id === id);
  if (!o || !ALL_STATUSES.includes(next) || isClosed(o.status) || next === o.status) return refresh();
  if (isClosed(next) && !confirm(t(next === 'Refused' ? 'msg.confirmRefused' : 'msg.confirmCancel'))) return refresh();
  try {
    await api('PATCH', `/orders/${id}/status`, { status: next });
    await refreshData();
  } catch (err) {
    showApiError(err);
    await refreshData().catch(() => {});
    return refresh();
  }
  toast(t('msg.statusMarked', { code: orderCode(o), status: statusLabel(next) }));
  refresh();
}

$('w-orders').addEventListener('change', (e) => {
  if (e.target.classList.contains('status-select')) changeOrderStatus(e.target.closest('tr').dataset.id, e.target.value);
});
$('order-body').addEventListener('change', (e) => {
  if (e.target.classList.contains('od-status')) changeOrderStatus(orderDialogId, e.target.value);
});

// Admin: CSV download (cells starting with = + - @ are prefixed so spreadsheets don't run them as formulas).
// The file is always in English so it opens the same way everywhere.
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
$('csv-btn').addEventListener('click', () => {
  const orders = allOrders();
  if (!orders.length) return toast(t('msg.noOrdersCsv'));
  const rows = [['Order ID', 'Date', 'Wholesaler', 'Customer', 'Mobile', 'Items', 'Total amount (Rs)', 'Delivery address', 'PIN code', 'Payment', 'Payment status', 'UTR', 'Status'],
    ...orders.map((o) => [orderCode(o), new Date(o.date).toLocaleString('en-IN'), o.store, customerName(o), customerMobile(o),
      o.items.map((i) => `${i.name} x ${i.qty}`).join('; '), o.total, o.address || '', o.pincode || '', o.payment || '', payStatusOf(o), o.payRef || '', o.status])];
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- Admin: edit product dialog ----------
const editForm = $('edit-form');
let editState = null;   // { id, images: [kept photos] }

function renderEditPhotos() {
  $('edit-photos').innerHTML = editState.images.length
    ? editState.images.map((src, i) => `<div class="edit-photo"><img src="${esc(src)}" alt="${te('alt.photo', { n: i + 1 })}"><button type="button" data-rm="${i}" aria-label="${te('aria.removePhoto', { n: i + 1 })}">✕</button></div>`).join('')
    : `<small class="field-label">${te('edit.noPhotos')}</small>`;
}

function openEdit(id) {
  if (!isAdmin(currentUser())) return;
  const p = getProducts().find((x) => x.id === id);
  if (!p) return;
  editState = { id, images: [...productImages(p)] };
  fillWhSelects();
  const f = editForm.elements;
  f.pname.value = p.name;
  f.pwholesaler.value = p.ownerId;
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
  if (!editState || !isAdmin(currentUser())) return;
  const f = editForm.elements;
  const r = parseProductForm(f, 0);
  if (r.error) return msgTo('edit-msg', r.error, 'error');

  const files = [...f.pimage.files];
  if (editState.images.length + files.length > MAX_PHOTOS) return msgTo('edit-msg', t('msg.editMaxPhotos', { n: MAX_PHOTOS }), 'error');
  const added = await Promise.all(files.map(readImage));
  if (added.includes(null)) return msgTo('edit-msg', t('msg.badImage'), 'error');

  await busy(e.submitter, async () => {
    const keepImages = editState.images.map((src) => src.split('/').pop());   // photo URLs end in the photo's id
    try {
      await api('PUT', `/products/${editState.id}`, { ...r.data, keepImages, newImages: added });
      await refreshData();
    } catch (err) {
      return showApiError(err, 'edit-msg', { name: r.data.name });
    }
    $('edit-dialog').close();
    editState = null;
    toast(t('msg.productUpdated'));
    renderAdmin();
  });
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
  if (isClosed(o.status)) return `<p class="closed-note"><span class="badge out">${te(`status.${o.status}`)}</span></p>`;
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
          <label><span>${te('card.qty')}</span> <input type="number" class="buy-qty" min="1" max="${max}" step="1" value="1" inputmode="numeric" aria-label="${te('aria.qtyOf', { name: p.name })}"></label>
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
        <div><b>${te('order.num', { code: orderCode(o) })}</b><small>${esc(fmtDate(o.date))} · ${esc(o.store)}${o.payment ? ` · ${esc(o.payment === 'UPI' ? payText(o) : o.payment)}` : ''}</small></div>
        <div class="oc-total">${te('order.total')}<b>${rs(o.total)}</b></div>
      </div>
      ${stepper(o)}
      <ul class="oc-items">${o.items.map((i) => `<li><div class="oi-main"><span>${esc(i.name)} × ${i.qty} <small>${te('order.each', { price: rs(i.price) })}</small></span>${i.productId && existing.has(i.productId)
        ? (o.status === 'Delivered'
          ? `<button type="button" class="link-btn oi-review" data-review-product="${esc(i.productId)}">${te('order.review')}</button>`
          : `<small class="oi-note">${te('order.afterDelivery')}</small>`)
        : ''}</div><span>${rs(i.total)}</span></li>`).join('')}</ul>
      <div class="oc-foot">
        <small>${o.address ? `📍 ${esc(o.address)}${o.pincode ? ` – ${esc(o.pincode)}` : ''}` : te('order.noAddress')}</small>
        <span class="oc-btns">${unpaidUpi(o) ? `<button type="button" class="btn btn-small" data-pay="${esc(o.id)}">${te('pay.now')}</button>` : ''}${canCustomerCancel(o) ? `<button type="button" class="btn btn-danger btn-small" data-cancel="${esc(o.id)}">${te('pay.cancel')}</button>` : ''}<button type="button" class="btn btn-outline btn-small" data-receipt="${esc(o.id)}">${te('order.receipt')}</button></span>
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
  if (e.type === 'change') e.target.value = qtyValue(e.target);   // typed 0, 99 or nothing: bring it back into range
  root.querySelector('.total-val').textContent = rs(lineTotal(priceOf(p), qtyValue(e.target)));
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
    const qty = sel ? qtyValue(sel) : 1;
    if (addToCart(id, qty) && act === 'buy') { $('detail-dialog').close(); openCart(); }
    return;
  }
  if (root.classList.contains('product') && (act === 'detail' || el.closest('.thumb'))) openDetail(id);
}

$('c-products').addEventListener('change', qtyChanged);
$('c-products').addEventListener('input', qtyChanged);
$('c-products').addEventListener('click', shopClick);
$('detail-body').addEventListener('change', qtyChanged);
$('detail-body').addEventListener('input', qtyChanged);
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
          <label><span>${te('card.qty')}</span> <input type="number" class="buy-qty" min="1" max="${max}" step="1" value="1" inputmode="numeric" aria-label="${te('aria.qtyOf', { name: p.name })}"></label>
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
$('detail-body').addEventListener('submit', async (e) => {
  if (e.target.id !== 'review-form') return;
  e.preventDefault();
  const user = currentUser();
  const id = e.target.dataset.id;
  const p = getProducts().find((x) => x.id === id);
  if (!p || !user || user.role !== 'customer') return;
  const hadReview = getReviews().some((r) => r.productId === id && r.customerId === user.id);
  if (purchaseState(user.id, id) !== 'delivered' && !hadReview) return msgTo('review-msg', t('rev.hintOrdered'), 'error');
  const rating = parseInt(e.target.elements.rating.value, 10);
  if (!(rating >= 1 && rating <= 5)) return msgTo('review-msg', t('rev.chooseStars'), 'error');
  const comment = e.target.elements.comment.value.trim().slice(0, 500);

  try {
    await api('PUT', `/products/${id}/review`, { rating, comment });   // the server checks that the order was really delivered
    await refreshData();
  } catch (err) {
    return showApiError(err, 'review-msg');
  }
  toast(t(hadReview ? 'rev.updated' : 'rev.thanks'));
  renderDetail(id);
  renderCustomer(user);
});

$('detail-body').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act="del-review"]');
  if (!b) return;
  const user = currentUser();
  const id = b.closest('.reviews').dataset.id;
  if (!confirm(t('rev.confirmDelete'))) return;
  try {
    await api('DELETE', `/products/${id}/review`);
    await refreshData();
  } catch (err) {
    return showApiError(err);
  }
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
  const keepPin = $('cart-pin');
  const pin = keepPin ? keepPin.value : (user.pincode || '');
  const keepPay = document.querySelector('input[name="cart-pay"]:checked');

  if (!lines.length) {
    $('cart-body').innerHTML = `<p class="empty">${te('cart.empty')}</p>`;
    return;
  }
  const total = sumTotal(lines.map(({ p, qty }) => ({ total: lineTotal(priceOf(p), qty) })));
  const codReason = codBlockReason(user, total);
  const pay = keepPay && !(keepPay.value === 'COD' && codReason) ? keepPay.value : 'UPI';
  $('cart-body').innerHTML = `
    <div class="cart-list">${lines.map(({ p, qty }) => {
      const img = productImages(p)[0];
      return `
      <div class="cart-line" data-id="${esc(p.id)}">
        <div class="cl-img">${img ? `<img src="${esc(img)}" alt="">` : esc(p.emoji || '📦')}</div>
        <div class="cl-info"><b>${esc(p.name)}</b><small>🏬 ${esc(p.store)}</small><small>${rs(priceOf(p))} ${te('card.perUnit')}</small></div>
        <input type="number" class="cart-qty" min="1" max="${Math.min(MAX_QTY, p.qty)}" step="1" value="${qty}" inputmode="numeric" aria-label="${te('aria.qtyOf', { name: p.name })}">
        <div class="cl-total">${rs(lineTotal(priceOf(p), qty))}</div>
        <button type="button" class="cart-remove" aria-label="${te('aria.removeFromCart', { name: p.name })}">✕</button>
      </div>`;
    }).join('')}</div>
    <div class="cart-total"><span>${te('card.totalAmount')}</span><strong>${rs(total)}</strong></div>
    <div class="cart-checkout">
      <label><span>${te('cart.address')}</span>
        <textarea id="cart-address" rows="3" maxlength="200" placeholder="${te('ph.address')}" autocomplete="street-address">${esc(address)}</textarea>
      </label>
      <label><span>${te('cart.pincode')}</span>
        <input type="text" id="cart-pin" inputmode="numeric" maxlength="6" autocomplete="postal-code" placeholder="${te('ph.pincode')}" value="${esc(pin)}">
      </label>
      <fieldset class="pay-pick">
        <legend class="field-label">${te('cart.payment')}</legend>
        <div class="role-pick">
          <label class="role"><input type="radio" name="cart-pay" value="UPI"${pay === 'UPI' ? ' checked' : ''}><span>${te('pay.upi')}</span></label>
          <label class="role"><input type="radio" name="cart-pay" value="COD"${pay === 'COD' ? ' checked' : ''}${codReason ? ' disabled' : ''}><span>${te('pay.cod')}</span></label>
        </div>
        ${codReason ? `<p class="demo-hint">${te(`cod.${codReason}`, { min: rs(getSettings().codMin) })}</p>` : ''}
        <p class="demo-hint">${te('pay.upiNote')}</p>
      </fieldset>
      <p class="form-msg" id="cart-msg" role="status"></p>
      <button type="button" class="btn btn-block" id="place-order">${te('cart.place')}</button>
    </div>`;
}

function openCart() {
  renderCart();
  if (!$('cart-dialog').open) $('cart-dialog').showModal();
}

async function placeOrder() {
  const user = currentUser();
  const address = $('cart-address').value.trim();
  const lines = cartLines();
  if (!lines.length) return;
  if (address.length < 5) return msgTo('cart-msg', t('cart.addrReq'), 'error');
  const pin = $('cart-pin').value.trim();
  if (!/^\d{6}$/.test(pin)) return msgTo('cart-msg', t('cart.pinReq'), 'error');
  if (!pincodeAllowed(pin)) return msgTo('cart-msg', t('cart.pinNo', { pin }), 'error');
  const payChoice = document.querySelector('input[name="cart-pay"]:checked');
  const payment = payChoice && PAYMENTS.includes(payChoice.value) ? payChoice.value : 'UPI';
  const cartTotal = sumTotal(lines.map(({ p, qty }) => ({ total: lineTotal(priceOf(p), qty) })));
  if (payment === 'COD' && codBlockReason(user, cartTotal)) return msgTo('cart-msg', t('cod.errPick'), 'error');

  // The server splits the cart into one order per wholesaler, checks the stock and the rules, and keeps the stock safe
  await busy($('place-order'), async () => {
    let placed;
    try {
      placed = (await api('POST', '/orders', { items: lines.map(({ p, qty }) => ({ productId: p.id, qty })), address, pincode: pin, payment })).orders;
      await refreshData();
    } catch (err) {
      await refreshData().catch(() => {});   // the shelf may have changed meanwhile: show what is really there
      renderCart();
      if ($('cart-msg')) msgTo('cart-msg', apiText(err), 'error'); else toast(apiText(err));   // a sold-out item empties the cart: then a toast explains
      return;
    }
    setCart([]);
    $('cart-dialog').close();
    toast(t('cart.placed', { total: rs(sumTotal(placed)) }));
    renderCustomer(currentUser());
    if (payment === 'UPI') openPay(placed[0].id);   // straight to the Pay screen
  });
}

$('cart-btn').addEventListener('click', openCart);
$('cart-body').addEventListener('change', (e) => {
  if (!e.target.classList.contains('cart-qty')) return;
  const id = e.target.closest('.cart-line').dataset.id;
  const cart = getCart();
  const line = cart.find((l) => l.id === id);
  if (line) { line.qty = qtyValue(e.target); setCart(cart); }
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

// ---------- Customer: pay by UPI ----------
// The customer pays from any UPI app (the button on a phone, or the QR on a computer) and types the UTR / transaction
// number. The admin checks the money arrived and marks the order paid. (Checking it automatically needs a payment gateway.)
let payOrderId = null;
const TEST_UPI = 'test@upi';   // while this is the UPI ID, the Pay screen has a "simulate payment" button
const unpaidUpi = (o) => o.payment === 'UPI' && payStatusOf(o) === 'Unpaid' && !isClosed(o.status);

function upiLink(amount, note) {
  const st = getSettings();
  const pa = encodeURIComponent(st.upiId).replace('%40', '@');
  return `upi://pay?pa=${pa}&pn=${encodeURIComponent(st.upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
}

function renderPay(id) {
  const me = currentUser();
  const o = getOrders().find((x) => x.id === id && me && x.customerId === me.id);
  const list = o ? groupOrders(o).filter(unpaidUpi) : [];
  if (!list.length) { payOrderId = null; return false; }
  payOrderId = id;
  const keepUtr = $('pay-form') ? $('pay-form').elements.utr.value : '';
  const total = sumTotal(list);
  const st = getSettings();
  const link = upiLink(total, `Order ${list.map(orderCode).join(' ')}`);
  $('pay-body').innerHTML = `
    <div class="pay-amount"><span>${te('pay.amount')}</span><strong>${rs(total)}</strong><small>${te('pay.forOrders', { codes: list.map((x) => `#${orderCode(x)}`).join(', ') })}</small></div>
    <a class="btn btn-block" href="${esc(link)}">${te('pay.app')}</a>
    <p class="demo-hint pay-or">${te('pay.orScan')}</p>
    <div class="pay-qr" id="pay-qr" role="img" aria-label="${te('pay.qrAria')}"></div>
    <p class="pay-to">${te('pay.to')} <b>${esc(st.upiId)}</b> <small>(${esc(st.upiName)})</small></p>
    ${st.upiId === TEST_UPI ? `<div class="pay-test"><button type="button" class="btn btn-outline btn-block" data-test-pay>${te('pay.test')}</button><p class="demo-hint">${te('pay.testNote')}</p></div>` : ''}
    <p class="demo-hint pay-hold">${te('pay.hold')}</p>
    <form id="pay-form" novalidate>
      <label><span>${te('pay.utr')}</span>
        <input type="text" name="utr" maxlength="22" autocomplete="off" placeholder="${te('ph.utr')}" value="${esc(keepUtr)}">
      </label>
      <p class="form-msg" id="pay-msg" role="status"></p>
      <button type="submit" class="btn btn-block">${te('pay.paid')}</button>
      <p class="demo-hint">${te('pay.verify')}</p>
    </form>`;
  const box = $('pay-qr');
  try {
    const qr = qrcode(0, 'M');   // qrcode.js is a small library that lives next to this file
    qr.addData(link);
    qr.make();
    box.innerHTML = qr.createSvgTag(5, 3);
  } catch { box.hidden = true; }   // no QR: the button and the UPI ID still work
  return true;
}

function openPay(id) {
  if (renderPay(id) && !$('pay-dialog').open) $('pay-dialog').showModal();
}

// auto = the (test) payment is known to have arrived, so the server marks the order Paid straight away.
// Returns '' or the text of an error.
async function submitPayment(utr, auto) {
  const base = getOrders().find((x) => x.id === payOrderId);
  if (!base) return t('api.NOT_WAITING');
  try {
    await api('POST', `/orders/${base.id}/${auto ? 'test-pay' : 'pay'}`, auto ? {} : { utr });
    await refreshData();
  } catch (err) {
    await refreshData().catch(() => {});
    return apiText(err);
  }
  $('pay-dialog').close();
  toast(t(auto ? 'pay.done' : 'pay.thanks'));
  renderCustomer(currentUser());
  return '';
}

$('pay-body').addEventListener('submit', async (e) => {
  if (e.target.id !== 'pay-form') return;
  e.preventDefault();
  const utr = e.target.elements.utr.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,22}$/.test(utr)) return msgTo('pay-msg', t('pay.errUtr'), 'error');
  await busy(e.submitter, async () => {
    const err = await submitPayment(utr, false);
    if (err) msgTo('pay-msg', err, 'error');
  });
});

// Test mode (UPI ID test@upi): no real money can move, so this button stands in for a payment that succeeded
$('pay-body').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-test-pay]');
  if (!b || getSettings().upiId !== TEST_UPI) return;
  await busy(b, async () => {
    const err = await submitPayment('', true);
    if (err) msgTo('pay-msg', err, 'error');
  });
});

// An unpaid UPI order only holds the stock: the customer can cancel it, and the server cancels it after 30 minutes by itself
const canCustomerCancel = (o) => ['Pending', 'Confirmed'].includes(o.status);

// The customer may cancel until the order ships. An unpaid UPI order is cancelled together with the rest of its payment;
// a paid one is cancelled on its own, and the admin gets a reminder to refund it.
async function cancelByCustomer(id) {
  try {
    const result = await api('POST', `/orders/${id}/cancel`, {});
    await refreshData();
    return result;
  } catch (err) {
    showApiError(err);
    await refreshData().catch(() => {});
    return null;
  }
}

$('c-orders').addEventListener('click', async (e) => {
  const pay = e.target.closest('[data-pay]');
  if (pay) return openPay(pay.dataset.pay);
  const cancel = e.target.closest('[data-cancel]');
  if (!cancel) return;
  const o = getOrders().find((x) => x.id === cancel.dataset.cancel);
  if (!o) return;
  const paid = ['Paid', 'Submitted'].includes(payStatusOf(o));
  if (!confirm(paid ? t('pay.confirmCancelPaid', { amount: rs(o.total) }) : t('pay.confirmCancel'))) return;
  const done = await busy(cancel, () => cancelByCustomer(o.id));
  if (done) toast(t(done.needsRefund ? 'pay.cancelledRefund' : 'pay.cancelled'));
  renderCustomer(currentUser());
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
        <div class="r-meta"><b>${te('order.num', { code: orderCode(o) })}</b><br>${esc(fmtDate(o.date))}${o.payment ? `<br>${te('order.payment', { method: payText(o) })}` : ''}</div>
      </div>
      <div class="r-parties">
        <div><h4>${te('rc.billed')}</h4>${esc(customerName(o))}<br>${esc(customerMobile(o))}<br>${o.address ? esc(o.address) + (o.pincode ? ` – ${esc(o.pincode)}` : '') : '—'}</div>
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
  f.address.value = user.address || '';
  msgTo('profile-msg', '');
  msgTo('password-msg', '');
  $('password-form').reset();
}

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = $('profile-form').elements;
  const name = f.name.value.trim();
  const mobile = normMobile(f.mobile.value);
  if (!name) return msgTo('profile-msg', t('err.name'), 'error');
  if (!validMobile(mobile)) return msgTo('profile-msg', t('err.mobileInvalid'), 'error');

  await busy(e.submitter, async () => {
    try {
      state.me = (await api('PATCH', '/auth/me', { name, mobile, address: f.address.value.trim(), pincode: state.me.pincode || '' })).user;
    } catch (err) {
      return showApiError(err, 'profile-msg');
    }
    renderChip(state.me);
    msgTo('profile-msg', t('p.saved'), 'ok');
    toast(t('toast.profileSaved'));
  });
});

$('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = $('password-form').elements;
  if (f.newpass.value.length < 6) return msgTo('password-msg', t('p.newShort'), 'error');
  if (f.newpass.value !== f.newpass2.value) return msgTo('password-msg', t('p.newMismatch'), 'error');
  await busy(e.submitter, async () => {
    try {
      await api('POST', '/auth/password', { current: f.current.value, next: f.newpass.value });
    } catch (err) {
      return showApiError(err, 'password-msg');
    }
    $('password-form').reset();
    msgTo('password-msg', t('p.pwUpdated'), 'ok');
    toast(t('toast.pwUpdated'));
  });
});

// ---------- Dialog helpers ----------
document.addEventListener('click', (e) => {
  const x = e.target.closest('[data-close]');
  if (x) x.closest('dialog').close();
});
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

// ---------- Start ----------
// Language is shared by the tabs of this browser; the login and all data come from the server.
window.addEventListener('storage', (e) => {
  if (e.key === KEY.lang) setLang(e.newValue, false);
});

let savedTheme = null;
let savedLang = null;
try { savedTheme = localStorage.getItem(KEY.theme); savedLang = localStorage.getItem(KEY.lang); } catch { /* ignore */ }
currentLang = savedLang === 'hi' ? 'hi' : 'en';   // English unless the visitor chose Hindi
applyTheme(savedTheme === 'light' ? 'light' : 'dark');
fillCatSelects();
fillWhSelects();
fillSubjectSelect();
applyStaticText();
setMode('login');
updateChannelText();
renderResendBtn();

async function start() {
  try {
    state.me = (await api('GET', '/auth/me')).user;   // is there still a login from last time?
    if (state.me) await refreshData();
  } catch (err) {
    forgetData();
    toast(apiText(err));
  }
  route();
  setInterval(syncFromServer, 20 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncFromServer(); });
}
start();
