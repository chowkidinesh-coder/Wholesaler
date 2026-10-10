// End to end: the real website (index.html + script.js) running in a simulated browser (jsdom), talking over HTTP to the real
// server, on PostgreSQL in memory. Each "page" has its own cookies, like a separate phone or computer.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { JSDOM } = require('jsdom');
const { pgliteAdapter, applySchema } = require('../src/db');
const { createApp } = require('../src/app');
const { ensureAdmin, seedDemo } = require('../scripts/init-db');

const webRoot = path.join(__dirname, '..', '..');
const readWeb = (f) => fs.readFileSync(path.join(webRoot, f), 'utf8');
const ADMIN = { email: 'boss@shop.com', password: 'Str0ngAdminPass' };
let db, server, baseUrl;
const pages = [];

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = pgliteAdapter(new PGlite());
  await applySchema(db);
  await ensureAdmin(db, { ADMIN_EMAIL: ADMIN.email, ADMIN_MOBILE: '9999999999', ADMIN_PASSWORD: ADMIN.password }, 4);
  await seedDemo(db, 4);   // customer@demo.com / demo123, two wholesalers, six products
  const { app } = createApp({ db, jwtSecret: 'test-secret-test-secret-test-secret-123', webRoot, bcryptRounds: 4, loginLimit: 10000, demoOtp: true, log: { error() {} } });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const p of pages) p.w.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

// ---------- a simulated browser page ----------
function openPage({ jar = new Map() } = {}) {
  let html = readWeb('index.html').replace(/<link[^>]*>/g, '');
  for (const f of ['qrcode.js', 'i18n.js', 'script.js']) html = html.replace(`<script src="${f}"></script>`, () => `<script>${readWeb(f)}</script>`);
  let inflight = 0;
  const errors = [];
  const dom = new JSDOM(html, {
    url: `${baseUrl}/`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
      w.confirm = () => true;
      w.alert = () => {};
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = () => {};
      w.addEventListener('error', (e) => errors.push(e.message));
      w.fetch = async (url, init = {}) => {   // the simulated browser's fetch: same server, own cookie jar
        inflight++;
        try {
          const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
          const res = await fetch(new URL(url, baseUrl), { ...init, headers: { ...(init.headers || {}), ...(cookie ? { cookie } : {}) } });
          for (const line of res.headers.getSetCookie()) {
            const [pair] = line.split(';');
            const i = pair.indexOf('=');
            const name = pair.slice(0, i);
            const value = pair.slice(i + 1);
            if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name); else jar.set(name, value);
          }
          return res;
        } finally { inflight--; }
      };
    },
  });
  const page = {
    w: dom.window, d: dom.window.document, jar, errors,
    async settle() {   // wait until the page has finished talking to the server
      let quiet = 0;
      while (quiet < 4) {
        await new Promise((r) => setTimeout(r, 12));
        quiet = inflight === 0 ? quiet + 1 : 0;
      }
    },
  };
  pages.push(page);
  return page;
}
const open = async (opts) => { const p = openPage(opts); await p.settle(); return p; };

const $ = (p, id) => p.d.getElementById(id);
const q = (p, sel) => p.d.querySelector(sel);
const qa = (p, sel) => [...p.d.querySelectorAll(sel)];
const text = (p, id) => $(p, id).textContent;
const fire = async (p, el, type = 'click') => { el.dispatchEvent(new p.w.Event(type, { bubbles: true, cancelable: true })); await p.settle(); };
const click = (p, el) => fire(p, typeof el === 'string' ? q(p, el) : el);
const submit = (p, form) => fire(p, typeof form === 'string' ? $(p, form) : form, 'submit');
const set = (el, value) => { el.value = value; };
const type = async (p, el, value) => { el.value = value; await fire(p, el, 'input'); };

async function login(p, email, password) {
  const f = $(p, 'auth-form').elements;
  set(f.email, email); set(f.password, password);
  await submit(p, 'auth-form');
}
const logout = (p) => click(p, $(p, 'logout-btn'));
const closeDialogs = (p) => qa(p, 'dialog[open]').forEach((d) => d.removeAttribute('open'));
async function adminPage() { const p = await open(); await login(p, ADMIN.email, ADMIN.password); return p; }
async function customerPage(email = 'customer@demo.com', password = 'demo123') { const p = await open(); await login(p, email, password); return p; }
const tab = (p, name) => click(p, `.atab[data-tab="${name}"]`);
const ordersOf = async (email) => (await db.query(`SELECT o.* FROM orders o JOIN users u ON u.id = o.customer_id WHERE u.email = $1 ORDER BY o.created_at`, [email])).rows;
const stockOf = async (name) => (await db.query('SELECT qty FROM products WHERE name = $1', [name])).rows[0].qty;

async function addToCartAndCheckout(p, productName, { qty = 1, address = '12 Main Street, Pune', pin = '411001', pay = null } = {}) {
  const card = qa(p, '#c-products .product').find((c) => c.querySelector('.p-name').textContent === productName);
  const input = card.querySelector('.buy-qty');
  if (input) await type(p, input, String(qty));
  await click(p, card.querySelector('[data-act="add"]'));
  await click(p, $(p, 'cart-btn'));
  set($(p, 'cart-address'), address);
  set($(p, 'cart-pin'), pin);
  if (pay) { const r = q(p, `input[name="cart-pay"][value="${pay}"]`); r.checked = true; }
  await click(p, $(p, 'place-order'));
}

// ====================================================================================================

test('the landing page shows Toys and Stationery, no demo logins, and a wrong login is refused', async () => {
  const p = await open();
  assert.ok(!$(p, 'auth-view').hidden);
  assert.deepEqual(qa(p, '.cat b').map((b) => b.textContent), ['Toys', 'Stationery']);
  const visible = p.d.body.cloneNode(true);
  visible.querySelectorAll('script').forEach((el) => el.remove());   // only what a visitor can read
  assert.ok(!visible.textContent.includes('demo123'), 'no demo password is shown on the page');
  assert.ok(!q(p, 'input[name="role"][value="wholesaler"]'), 'no wholesaler login');
  await login(p, 'customer@demo.com', 'wrong-password');
  assert.match(text(p, 'auth-msg'), /No account matches/);
  assert.ok(!$(p, 'auth-view').hidden, 'still on the login page');
  await login(p, 'nope', 'x');
  assert.match(text(p, 'auth-msg'), /valid email/);
  assert.deepEqual(p.errors, []);
});

test('admin logs in with the real account and sees the control room built from the database', async () => {
  const p = await adminPage();
  assert.ok(!$(p, 'admin-view').hidden && $(p, 'auth-view').hidden);
  assert.match(text(p, 'user-chip'), /Admin/);
  assert.equal(qa(p, '#w-stats .stat').length, 6);
  assert.ok(!q(p, '.admin-tab[data-tab="orders"]').hidden && q(p, '.admin-tab[data-tab="wholesalers"]').hidden, 'opens on Orders');
  await tab(p, 'wholesalers');
  assert.equal(qa(p, '#wh-list tbody tr').length, 2);
  await tab(p, 'products');
  assert.equal(qa(p, '#w-products .product').length, 6);
  assert.equal(qa(p, '#product-form select[name="pwholesaler"] option').length, 2);
  await tab(p, 'rules');
  assert.equal($(p, 'rules-form').elements.upiId.value, 'test@upi');
  assert.equal($(p, 'rules-form').elements.codMin.value, '5000');
  assert.deepEqual(p.errors, []);
});

test('the login survives a page reload, logout ends it, and an ended session sends the visitor back to the login page', async () => {
  const p = await adminPage();
  const again = await open({ jar: p.jar });   // "reload": new page, same cookies
  assert.ok(!$(again, 'admin-view').hidden, 'still logged in after a reload');
  await logout(p);
  assert.ok(!$(p, 'auth-view').hidden && $(p, 'admin-view').hidden);
  const gone = await open({ jar: p.jar });
  assert.ok(!$(gone, 'auth-view').hidden, 'after logout a reload shows the login page');
  // the session ends while the page is open (cookie removed): the next refresh notices
  const c = await customerPage();
  c.jar.clear();
  await c.w.syncFromServer();
  await c.settle();
  assert.ok(!$(c, 'auth-view').hidden, 'back on the login page');
  assert.match(text(c, 'toast'), /log in again/i);
});

test('admin: add, edit and delete a wholesaler (with the server refusing duplicates and bad numbers)', async () => {
  const p = await adminPage();
  await tab(p, 'wholesalers');
  const f = $(p, 'wholesaler-form').elements;
  set(f.wstore, 'Bright Books'); set(f.wname, 'Ravi'); set(f.wmobile, '98765 43210');
  await submit(p, 'wholesaler-form');
  assert.equal(qa(p, '#wh-list tbody tr').length, 3);
  assert.equal((await db.query(`SELECT mobile FROM wholesalers WHERE store = 'Bright Books'`)).rows[0].mobile, '9876543210', 'saved in the database');
  set(f.wstore, 'bright BOOKS'); set(f.wname, 'X'); set(f.wmobile, '9876543211');
  await submit(p, 'wholesaler-form');
  assert.match(text(p, 'wh-msg'), /already added/);
  set(f.wstore, 'Other'); set(f.wmobile, '12');
  await submit(p, 'wholesaler-form');
  assert.match(text(p, 'wh-msg'), /valid mobile/);
  $(p, 'wholesaler-form').reset();
  // edit
  const row = () => qa(p, '#wh-list tbody tr').find((r) => r.textContent.includes('Bright Books'));
  await click(p, row().querySelector('.wh-edit'));
  assert.equal(f.wstore.value, 'Bright Books');
  set(f.wstore, 'Bright Books Ltd');
  await submit(p, 'wholesaler-form');
  assert.ok(qa(p, '#wh-list tbody tr').some((r) => r.textContent.includes('Bright Books Ltd')));
  assert.equal($(p, 'wh-cancel').hidden, true);
  // delete
  await click(p, qa(p, '#wh-list tbody tr').find((r) => r.textContent.includes('Bright Books Ltd')).querySelector('.wh-del'));
  assert.equal(qa(p, '#wh-list tbody tr').length, 2);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM wholesalers WHERE store LIKE 'Bright%'`)).rows[0].n, 0);
  assert.deepEqual(p.errors, []);
});

test('admin: add, update stock and delete a product', async () => {
  const p = await adminPage();
  await tab(p, 'products');
  const f = $(p, 'product-form').elements;
  const toys = (await db.query(`SELECT id FROM wholesalers WHERE store = 'Happy Toys Store'`)).rows[0].id;
  set(f.pname, 'Spinning Top'); set(f.pwholesaler, toys); set(f.pcat, 'Toys'); set(f.pqty, '15'); set(f.pprice, '49.5'); set(f.pdesc, 'Spins');
  await submit(p, 'product-form');
  const row = (await db.query(`SELECT * FROM products WHERE name = 'Spinning Top'`)).rows[0];
  assert.ok(row && Number(row.price) === 49.5 && row.qty === 15, 'saved in the database');
  assert.equal(f.pwholesaler.value, toys, 'the wholesaler choice stays for the next product');
  assert.ok(qa(p, '#w-products .product').some((c) => c.textContent.includes('Spinning Top')));
  set(f.pname, 'spinning top'); set(f.pqty, '1');
  await submit(p, 'product-form');
  assert.match(text(p, 'product-msg'), /already added/);
  // quick edit of price and stock
  const card = () => qa(p, '#w-products .product').find((c) => c.querySelector('.p-name').textContent === 'Spinning Top');
  set(card().querySelector('.price-input'), '55');
  set(card().querySelector('.stock-input'), '9');
  await click(p, card().querySelector('.save-price'));
  const after = (await db.query(`SELECT price, qty FROM products WHERE name = 'Spinning Top'`)).rows[0];
  assert.equal(Number(after.price), 55);
  assert.equal(after.qty, 9);
  await click(p, card().querySelector('.del-btn'));
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM products WHERE name = 'Spinning Top'`)).rows[0].n, 0);
  assert.deepEqual(p.errors, []);
});

test('admin: edit dialog changes a product', async () => {
  const p = await adminPage();
  await tab(p, 'products');
  const card = qa(p, '#w-products .product').find((c) => c.querySelector('.p-name').textContent === 'Toy Cars');
  await click(p, card.querySelector('.edit-btn'));
  assert.ok($(p, 'edit-dialog').hasAttribute('open'));
  const f = $(p, 'edit-form').elements;
  assert.equal(f.pname.value, 'Toy Cars');
  set(f.pname, 'Toy Cars XL'); set(f.pprice, '120'); set(f.pqty, '8');
  await submit(p, 'edit-form');
  assert.ok(!$(p, 'edit-dialog').hasAttribute('open'));
  assert.equal(Number((await db.query(`SELECT price FROM products WHERE name = 'Toy Cars XL'`)).rows[0].price), 120);
  await db.query(`UPDATE products SET name = 'Toy Cars', price = 100 WHERE name = 'Toy Cars XL'`);
});

test('customer: register on the page, duplicates refused, then logout and login again', async () => {
  const p = await open();
  await click(p, '.tab[data-mode="register"]');
  const f = $(p, 'auth-form').elements;
  const fill = (email, mobile) => { set(f.name, 'Asha Rao'); set(f.email, email); set(f.mobile, mobile); set(f.password, 'secret1'); set(f.confirm, 'secret1'); };
  fill('asha@example.com', '9811111111');
  await submit(p, 'auth-form');
  assert.ok(!$(p, 'customer-view').hidden, 'logged in as a customer');
  assert.match(text(p, 'user-chip'), /Asha Rao/);
  assert.equal((await db.query(`SELECT role FROM users WHERE email = 'asha@example.com'`)).rows[0].role, 'customer');
  await logout(p);
  await click(p, '.tab[data-mode="register"]');
  fill('asha@example.com', '9822222222');
  await submit(p, 'auth-form');
  assert.match(text(p, 'auth-msg'), /already registered/);
  fill('new@example.com', '9811111111');
  await submit(p, 'auth-form');
  assert.match(text(p, 'auth-msg'), /already registered/);
  set(f.confirm, 'different');
  await submit(p, 'auth-form');
  assert.match(text(p, 'auth-msg'), /do not match/);
  await click(p, '.tab[data-mode="login"]');
  await login(p, 'ASHA@example.com', 'secret1');
  assert.ok(!$(p, 'customer-view').hidden);
  assert.deepEqual(p.errors, []);
});

test('customer shop: 6 products, categories, search, number box for quantity', async () => {
  const p = await customerPage();
  assert.equal(qa(p, '#c-chips .chip').length, 5, 'All, Toys, Stationery, Other, Wishlist');
  assert.equal(qa(p, '#c-products .product').length, 6);
  await click(p, '.chip[data-cat="Stationery"]');
  assert.equal(qa(p, '#c-products .product').length, 3);
  await click(p, '.chip[data-cat="All"]');
  await type(p, $(p, 'c-search'), 'pen');
  assert.equal(qa(p, '#c-products .product').length, 1);
  await type(p, $(p, 'c-search'), '');
  const input = qa(p, '#c-products .product').find((c) => c.querySelector('.p-name').textContent === 'Ball Pens (box of 50)').querySelector('.buy-qty');
  assert.equal(input.type, 'number');
  await type(p, input, '5');
  assert.equal(input.closest('.product').querySelector('.total-val').textContent, 'Rs 1,250');
  input.value = '99';
  await fire(p, input, 'change');
  assert.equal(input.value, '20', 'above the limit goes back to the maximum');
  input.value = '0';
  await fire(p, input, 'change');
  assert.equal(input.value, '1');
  assert.deepEqual(p.errors, []);
});

test('checkout: the PIN is required, COD is closed for a small order, and the UPI order goes to the Pay screen', async () => {
  const c = await customerPage();
  const before = await stockOf('Notebooks (pack of 12)');
  const card = qa(c, '#c-products .product').find((x) => x.querySelector('.p-name').textContent === 'Notebooks (pack of 12)');
  await click(c, card.querySelector('[data-act="add"]'));
  await click(c, $(c, 'cart-btn'));
  assert.ok($(c, 'cart-dialog').hasAttribute('open'));
  set($(c, 'cart-address'), '12 Main Street, Pune');
  await click(c, $(c, 'place-order'));
  assert.match(text(c, 'cart-msg'), /PIN/);
  assert.equal((await ordersOf('customer@demo.com')).length, 0);
  assert.ok(q(c, 'input[name="cart-pay"][value="COD"]').disabled, 'Rs 360 is below the Rs 5000 COD minimum');
  assert.ok(q(c, 'input[name="cart-pay"][value="UPI"]').checked);
  set($(c, 'cart-pin'), '411001');
  await click(c, $(c, 'place-order'));
  const [order] = await ordersOf('customer@demo.com');
  assert.equal(order.payment, 'UPI');
  assert.equal(order.pay_status, 'Unpaid');
  assert.equal(Number(order.total), 360);
  assert.equal(await stockOf('Notebooks (pack of 12)'), before - 1, 'the stock was taken in the database');
  assert.ok($(c, 'pay-dialog').hasAttribute('open'), 'the Pay screen opens');
  const link = q(c, '#pay-body a.btn').getAttribute('href');
  assert.ok(link.startsWith('upi://pay?pa=test@upi&pn=Wholesale%20Market&am=360.00&cu=INR&tn=Order%20'), link);
  assert.ok(q(c, '#pay-qr svg'), 'a QR code is drawn');
  assert.ok(q(c, '#pay-body [data-test-pay]'), 'test button while the UPI ID is test@upi');
  assert.deepEqual(c.errors, []);
  closeDialogs(c);
});

test('two devices: the admin does not see an unpaid UPI order, and sees it the moment the customer pays', async () => {
  const admin = await adminPage();
  assert.ok(text(admin, 'w-orders').includes('No orders yet'), 'unpaid order is hidden from the admin');
  const c = await customerPage();
  await click(c, '#c-orders [data-pay]');
  assert.ok($(c, 'pay-dialog').hasAttribute('open'), 'Pay now reopens the Pay screen');
  await click(c, '#pay-body [data-test-pay]');   // simulated successful payment
  const [order] = await ordersOf('customer@demo.com');
  assert.equal(order.pay_status, 'Paid');
  assert.equal(order.status, 'Confirmed', 'paid orders are confirmed by themselves');
  assert.match(order.pay_ref, /^TEST\d{8}$/);
  assert.ok(!$(c, 'pay-dialog').hasAttribute('open'));
  assert.match(text(c, 'c-orders'), /Paid/);
  await admin.w.syncFromServer();   // the admin's page asks the server again (it also does this every 20 seconds)
  await admin.settle();
  const row = q(admin, '#w-orders tbody tr');
  assert.ok(row, 'now the admin sees the order');
  assert.ok(row.textContent.includes('Paid') && row.textContent.includes('Demo Customer'));
  assert.equal(row.querySelector('.status-select').value, 'Confirmed');
  assert.deepEqual([admin.errors, c.errors], [[], []]);
});

test('admin: order details dialog, WhatsApp messages and changing the status', async () => {
  const p = await adminPage();
  assert.ok(!q(p, '#w-orders a.wa-btn'), 'the list itself is short');
  await click(p, '#w-orders .view-order');
  const body = text(p, 'order-body');
  assert.ok($(p, 'order-dialog').hasAttribute('open'));
  for (const s of ['Demo Customer', '12 Main Street', '411001', 'Smart Stationery Mart', 'Notebooks (pack of 12)', 'Rs 360', 'UTR', 'TEST']) assert.ok(body.includes(s), s);
  const links = qa(p, '#order-body a.wa-btn').map((a) => decodeURIComponent(a.getAttribute('href')));
  assert.equal(links.length, 2);
  assert.ok(links[0].startsWith('https://wa.me/919000000012?text=') && links[0].includes('PAID by UPI') && links[0].includes('Notebooks (pack of 12) x 1'), 'seller gets the item list');
  assert.ok(links[1].startsWith('https://wa.me/919000000002?text=') && links[1].includes('is successful ✅') && links[1].includes('Total paid: Rs 360'), 'customer gets the invoice');
  const sel = q(p, '#order-body .od-status');
  set(sel, 'Shipped');
  await fire(p, sel, 'change');
  assert.equal((await ordersOf('customer@demo.com'))[0].status, 'Shipped');
  assert.equal(q(p, '#order-body .od-status').value, 'Shipped');
  closeDialogs(p);
  assert.deepEqual(p.errors, []);
});

test('customer: the progress of the order follows the admin, and a shipped order cannot be cancelled', async () => {
  const c = await customerPage();
  assert.match(q(c, '#c-orders .track li.current').textContent, /Shipped/);
  assert.ok(!q(c, '#c-orders [data-cancel]'), 'no Cancel button once shipped');
  assert.ok(q(c, '#c-orders [data-receipt]'));
  await click(c, '#c-orders [data-receipt]');
  assert.ok(text(c, 'receipt-body').includes('Notebooks (pack of 12)'));
  closeDialogs(c);
});

test('cancel a paid order: stock back, the admin sees "Cancelled by customer / Refund due" and settles it', async () => {
  const c = await customerPage();
  const card = qa(c, '#c-products .product').find((x) => x.querySelector('.p-name').textContent === 'Geometry Box');
  const before = await stockOf('Geometry Box');
  await click(c, card.querySelector('[data-act="add"]'));
  await click(c, $(c, 'cart-btn'));
  set($(c, 'cart-address'), '12 Main Street, Pune'); set($(c, 'cart-pin'), '411001');
  await click(c, $(c, 'place-order'));
  await click(c, '#pay-body [data-test-pay]');
  const geometry = (await ordersOf('customer@demo.com')).find((o) => o.total === '90.00');
  assert.equal(geometry.status, 'Confirmed');
  assert.equal(await stockOf('Geometry Box'), before - 1);
  await click(c, q(c, `#c-orders [data-cancel="${geometry.id}"]`));
  assert.match(text(c, 'toast'), /refund/i);
  const cancelled = (await ordersOf('customer@demo.com')).find((o) => o.id === geometry.id);
  assert.equal(cancelled.status, 'Cancelled');
  assert.equal(cancelled.cancelled_by, 'customer');
  assert.equal(await stockOf('Geometry Box'), before, 'stock is back');
  assert.ok(q(c, '#c-orders .closed-note .badge'), 'the customer sees a Cancelled badge');

  const admin = await adminPage();
  assert.match(text(admin, 'w-alerts'), /1 cancelled order\(s\) need a refund/);
  const row = qa(admin, '#w-orders tbody tr').find((r) => r.dataset.id === geometry.id);
  assert.ok(row.className.includes('cancelled-row') && row.textContent.includes('Cancelled by customer') && row.textContent.includes('Refund due'));
  await click(admin, '#w-alerts .view-order');
  assert.ok(text(admin, 'order-body').includes('Cancelled by the customer'));
  assert.ok(q(admin, '#order-body .od-warn'), 'refund reminder');
  await click(admin, '#order-body [data-pay-act="Unpaid"]');   // refunded: set back to unpaid
  assert.equal((await ordersOf('customer@demo.com')).find((o) => o.id === geometry.id).pay_status, 'Unpaid');
  assert.equal(text(admin, 'w-alerts').trim(), '', 'the alert is gone');
  assert.equal((await ordersOf('customer@demo.com')).find((o) => o.total === '360.00').pay_status, 'Paid', 'the other order is untouched');
  closeDialogs(admin);
  assert.deepEqual([admin.errors, c.errors], [[], []]);
});

test('unpaid UPI: the customer can cancel it, and the admin never sees it', async () => {
  const c = await customerPage();
  const before = await stockOf('Toy Cars');
  await addToCartAndCheckout(c, 'Toy Cars', { qty: 2 });
  assert.equal(await stockOf('Toy Cars'), before - 2);
  closeDialogs(c);
  const unpaid = (await ordersOf('customer@demo.com')).find((o) => o.pay_status === 'Unpaid' && o.status === 'Pending');
  await click(c, q(c, `#c-orders [data-cancel="${unpaid.id}"]`));
  assert.equal((await ordersOf('customer@demo.com')).find((o) => o.id === unpaid.id).status, 'Cancelled');
  assert.equal(await stockOf('Toy Cars'), before, 'stock is back');
  const admin = await adminPage();
  assert.ok(!qa(admin, '#w-orders tbody tr').some((r) => r.dataset.id === unpaid.id), 'never visible to the admin');
});

test('UTR payment: the admin must check the money and mark it paid, then the order is confirmed', async () => {
  const admin = await adminPage();
  await tab(admin, 'rules');
  const rf = $(admin, 'rules-form').elements;
  set(rf.upiId, 'shop@okaxis'); set(rf.upiName, 'Happy Shop');
  await submit(admin, 'rules-form');
  assert.match(text(admin, 'rules-msg'), /saved/i);
  assert.equal((await db.query(`SELECT value FROM settings WHERE key = 'app'`)).rows[0].value.upiId, 'shop@okaxis');

  const c = await customerPage();
  await addToCartAndCheckout(c, 'Toy Cars', { qty: 1 });
  assert.ok($(c, 'pay-dialog').hasAttribute('open'));
  assert.ok(!q(c, '#pay-body [data-test-pay]'), 'no test button with a real UPI ID');
  assert.ok(text(c, 'pay-body').includes('shop@okaxis'));
  assert.ok(q(c, '#pay-body a.btn').getAttribute('href').startsWith('upi://pay?pa=shop@okaxis&pn=Happy%20Shop'));
  set($(c, 'pay-form').elements.utr, '12');
  await submit(c, 'pay-form');
  assert.match(text(c, 'pay-msg'), /UTR/);
  set($(c, 'pay-form').elements.utr, 'abcd12345678');
  await submit(c, 'pay-form');
  const order = (await ordersOf('customer@demo.com')).find((o) => o.pay_ref === 'ABCD12345678');
  assert.equal(order.pay_status, 'Submitted');
  assert.equal(order.status, 'Pending');
  assert.match(text(c, 'c-orders'), /Verifying/);

  await admin.w.syncFromServer();
  await admin.settle();
  await tab(admin, 'orders');
  const row = qa(admin, '#w-orders tbody tr').find((r) => r.dataset.id === order.id);
  assert.ok(row && row.textContent.includes('Verifying'));
  await click(admin, row.querySelector('.view-order'));
  assert.ok(text(admin, 'order-body').includes('ABCD12345678'));
  await click(admin, '#order-body [data-pay-act="Paid"]');
  const done = (await ordersOf('customer@demo.com')).find((o) => o.id === order.id);
  assert.equal(done.pay_status, 'Paid');
  assert.equal(done.status, 'Confirmed');
  closeDialogs(admin);

  // back to the test ID for the next tests
  await tab(admin, 'rules');
  set(rf.upiId, 'test@upi');
  await submit(admin, 'rules-form');
  assert.deepEqual([admin.errors, c.errors], [[], []]);
});

test('COD rules: needs the minimum amount, and the delivery PIN list is enforced', async () => {
  const admin = await adminPage();
  await tab(admin, 'rules');
  const rf = $(admin, 'rules-form').elements;
  set(rf.codMin, '300'); set(rf.pincodes, '411001, 411002');
  await submit(admin, 'rules-form');
  const st = (await db.query(`SELECT value FROM settings WHERE key = 'app'`)).rows[0].value;
  assert.equal(st.codMin, 300);
  assert.deepEqual(st.pincodes, ['411001', '411002']);
  set(rf.codMin, '-5');
  await submit(admin, 'rules-form');
  assert.match(text(admin, 'rules-msg'), /minimum amount/i);
  set(rf.codMin, '300'); set(rf.pincodes, '411001, 12');
  await submit(admin, 'rules-form');
  assert.match(text(admin, 'rules-msg'), /6 digits/);

  const c = await customerPage();   // loads the new rules
  const small = qa(c, '#c-products .product').find((x) => x.querySelector('.p-name').textContent === 'Geometry Box');
  await click(c, small.querySelector('[data-act="add"]'));
  await click(c, $(c, 'cart-btn'));
  assert.ok(q(c, 'input[name="cart-pay"][value="COD"]').disabled, 'Rs 90 is below the minimum of Rs 300');
  const big = qa(c, '#c-products .product').find((x) => x.querySelector('.p-name').textContent === 'Notebooks (pack of 12)');
  await click(c, big.querySelector('[data-act="add"]'));
  await click(c, $(c, 'cart-btn'));   // redraw the cart: Rs 90 + Rs 360 = Rs 450
  assert.ok(!q(c, 'input[name="cart-pay"][value="COD"]').disabled, 'COD opens at Rs 450');
  set($(c, 'cart-address'), '12 Main Street, Pune');
  set($(c, 'cart-pin'), '999999');
  q(c, 'input[name="cart-pay"][value="COD"]').checked = true;
  await click(c, $(c, 'place-order'));
  assert.match(text(c, 'cart-msg'), /999999/);
  set($(c, 'cart-pin'), '411002');
  q(c, 'input[name="cart-pay"][value="COD"]').checked = true;
  await click(c, $(c, 'place-order'));
  const cod = (await ordersOf('customer@demo.com')).find((o) => o.payment === 'COD');
  assert.ok(cod && Number(cod.total) === 450 && cod.pincode === '411002' && cod.pay_status === '');
  assert.ok(!$(c, 'pay-dialog').hasAttribute('open'), 'no Pay screen for COD');
  assert.ok(text(c, 'c-orders').includes('COD'));

  // the admin refuses delivery at the door: the order ends and the stock returns
  const stockBefore = await stockOf('Geometry Box');
  await admin.w.syncFromServer(); await admin.settle();
  await tab(admin, 'orders');
  const row = qa(admin, '#w-orders tbody tr').find((r) => r.dataset.id === cod.id);
  const sel = row.querySelector('.status-select');
  set(sel, 'Refused');
  await fire(admin, sel, 'change');
  assert.equal((await ordersOf('customer@demo.com')).find((o) => o.id === cod.id).status, 'Refused');
  assert.equal(await stockOf('Geometry Box'), stockBefore + 1, 'refused goods go back on the shelf');
  assert.ok(qa(admin, '#w-orders tbody tr').find((r) => r.dataset.id === cod.id).querySelector('.status-select').disabled, 'a closed order cannot change');

  // back to the defaults
  await tab(admin, 'rules');
  set(rf.codMin, '5000'); set(rf.pincodes, '');
  await submit(admin, 'rules-form');
  assert.deepEqual([admin.errors, c.errors], [[], []]);
});

test('two customers, one last item: the server keeps the stock honest and the page explains what happened', async () => {
  await db.query(`UPDATE products SET qty = 1 WHERE name = 'Building Blocks'`);
  const a = await customerPage();
  const b = await customerPage('asha@example.com', 'secret1');
  for (const p of [a, b]) {
    const card = qa(p, '#c-products .product').find((x) => x.querySelector('.p-name').textContent === 'Building Blocks');
    await click(p, card.querySelector('[data-act="add"]'));
    await click(p, $(p, 'cart-btn'));
    set($(p, 'cart-address'), '12 Main Street, Pune'); set($(p, 'cart-pin'), '411001');
  }
  await click(a, $(a, 'place-order'));
  assert.equal(await stockOf('Building Blocks'), 0, 'a got the last one');
  assert.ok($(a, 'pay-dialog').hasAttribute('open'));
  closeDialogs(a);
  await click(b, $(b, 'place-order'));
  assert.match(text(b, 'toast'), /not enough stock|no longer available/, 'the page explains why the order did not go through');
  assert.equal((await ordersOf('asha@example.com')).length, 0, 'b got nothing');
  assert.equal(await stockOf('Building Blocks'), 0, 'the stock never goes below zero');
  closeDialogs(b);
  const unpaid = (await ordersOf('customer@demo.com')).find((o) => o.pay_status === 'Unpaid' && o.status === 'Pending');
  await click(a, q(a, `#c-orders [data-cancel="${unpaid.id}"]`));
  assert.equal(await stockOf('Building Blocks'), 1);
  await db.query(`UPDATE products SET qty = 8 WHERE name = 'Building Blocks'`);
});

test('reviews: only after delivery, can be changed and deleted', async () => {
  const c = await customerPage();
  const notebooks = qa(c, '#c-products .product').find((x) => x.querySelector('.p-name').textContent === 'Notebooks (pack of 12)');
  await click(c, notebooks.querySelector('.p-name'));
  assert.ok($(c, 'detail-dialog').hasAttribute('open'));
  assert.ok(!q(c, '#review-form'), 'no form: the order is not delivered');
  closeDialogs(c);
  await db.query(`UPDATE orders SET status = 'Delivered' WHERE status = 'Shipped'`);   // what the admin does when it arrives
  await c.w.syncFromServer(); await c.settle();
  const review = qa(c, '#c-orders [data-review-product]');
  assert.ok(review.length >= 1, 'Rate & review appears on a delivered order');
  await click(c, review[0]);
  assert.ok(q(c, '#review-form'));
  q(c, '#rate4').checked = true;
  set(q(c, '#review-form').elements.comment, 'Good paper');
  await submit(c, q(c, '#review-form'));
  assert.equal((await db.query('SELECT rating, comment FROM reviews')).rows[0].rating, 4);
  assert.ok(text(c, 'detail-body').includes('Good paper'));
  q(c, '#rate5').checked = true;
  await submit(c, q(c, '#review-form'));
  assert.equal((await db.query('SELECT rating FROM reviews')).rows[0].rating, 5);
  const admin = await adminPage();
  await tab(admin, 'reviews');
  assert.ok(text(admin, 'w-reviews').includes('Good paper'));
  await click(c, q(c, '[data-act="del-review"]'));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM reviews')).rows[0].n, 0);
  closeDialogs(c);
  assert.deepEqual([admin.errors, c.errors], [[], []]);
});

test('profile and password change', async () => {
  const c = await customerPage('asha@example.com', 'secret1');
  await click(c, $(c, 'profile-btn'));
  assert.ok(!$(c, 'profile-view').hidden);
  const f = $(c, 'profile-form').elements;
  assert.equal(f.email.value, 'asha@example.com');
  set(f.name, 'Asha R'); set(f.address, '5 Lake Road, Pune');
  await submit(c, 'profile-form');
  assert.match(text(c, 'profile-msg'), /saved/i);
  const u = (await db.query(`SELECT name, address FROM users WHERE email = 'asha@example.com'`)).rows[0];
  assert.equal(u.name, 'Asha R');
  assert.equal(u.address, '5 Lake Road, Pune');
  assert.match(text(c, 'user-chip'), /Asha R/);
  const pf = $(c, 'password-form').elements;
  set(pf.current, 'wrong-wrong'); set(pf.newpass, 'newsecret1'); set(pf.newpass2, 'newsecret1');
  await submit(c, 'password-form');
  assert.match(text(c, 'password-msg'), /current password is incorrect/);
  set(pf.current, 'secret1');
  await submit(c, 'password-form');
  assert.match(text(c, 'password-msg'), /updated/i);
  await logout(c);
  await login(c, 'asha@example.com', 'secret1');
  assert.ok(!$(c, 'auth-view').hidden, 'the old password no longer works');
  await login(c, 'asha@example.com', 'newsecret1');
  assert.ok(!$(c, 'customer-view').hidden);
  assert.deepEqual(c.errors, []);
});

test('forgot password: the code shown on screen resets the password', async () => {
  const p = await open();
  await click(p, $(p, 'forgot-link'));
  assert.ok(!$(p, 'reset-box').hidden);
  const rf = $(p, 'reset-request').elements;
  set(rf.identifier, 'ghost@example.com');
  await submit(p, 'reset-request');
  assert.match(text(p, 'reset-msg1'), /No account found/);
  set(rf.identifier, 'customer@demo.com');
  await submit(p, 'reset-request');
  assert.ok(!$(p, 'reset-verify').hidden);
  const code = (text(p, 'demo-otp').match(/\d{6}/) || [])[0];
  assert.match(code, /^\d{6}$/, 'the demo code is shown (DEMO_OTP is on in this test)');
  const vf = $(p, 'reset-verify').elements;
  set(vf.otp, code === '000000' ? '111111' : '000000'); set(vf.newpass, 'demo-new-1'); set(vf.newpass2, 'demo-new-1');
  await submit(p, 'reset-verify');
  assert.match(text(p, 'reset-msg2'), /Incorrect code\. 4 attempt/);
  set(vf.otp, code);
  await submit(p, 'reset-verify');
  assert.match(text(p, 'auth-msg'), /Password reset successful/);
  await login(p, 'customer@demo.com', 'demo-new-1');
  assert.ok(!$(p, 'customer-view').hidden);
  await db.query("UPDATE users SET password_hash = $1 WHERE email = 'customer@demo.com'", [require('bcryptjs').hashSync('demo123', 4)]);   // put the demo password back for the later tests
  assert.deepEqual(p.errors, []);
});

test('help page: the contact form saves a message in the database', async () => {
  const p = await open();
  await click(p, '.foot-link');
  assert.ok(!$(p, 'help-view').hidden);
  const f = $(p, 'contact-form').elements;
  set(f.name, 'Visitor'); set(f.email, 'v@example.com'); set(f.message, 'short');
  await submit(p, 'contact-form');
  assert.match(text(p, 'contact-msg'), /at least 10/);
  set(f.message, 'Where is my order please?');
  await submit(p, 'contact-form');
  assert.match(text(p, 'contact-msg'), /Reference: #[A-F0-9]{6}/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM contact_messages')).rows[0].n, 1);
});

test('Hindi: the admin pages, the order dialog and server messages switch language', async () => {
  const p = await adminPage();
  const sel = $(p, 'lang-select');
  set(sel, 'hi');
  await fire(p, sel, 'change');
  assert.equal(q(p, '.atab[data-tab="wholesalers"]').textContent, 'थोक विक्रेता');
  await tab(p, 'wholesalers');
  const f = $(p, 'wholesaler-form').elements;
  set(f.wstore, 'Happy Toys Store'); set(f.wname, 'X'); set(f.wmobile, '9876543210');
  await submit(p, 'wholesaler-form');
  assert.match(text(p, 'wh-msg'), /पहले से जोड़ा जा चुका है/, 'the duplicate message from the server comes in Hindi');
  set(sel, 'en');
  await fire(p, sel, 'change');
  assert.deepEqual(p.errors, []);
});

test('a customer cannot reach admin features from the page or the API', async () => {
  const c = await customerPage();
  assert.ok($(c, 'admin-view').hidden);
  const res = await c.w.fetch('/api/wholesalers');
  assert.equal(res.status, 403);
  const res2 = await c.w.fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codMin: 1, pincodes: [], upiId: 'evil@upi' }) });
  assert.equal(res2.status, 403);
  assert.equal((await db.query(`SELECT value FROM settings WHERE key = 'app'`)).rows[0].value.upiId, 'test@upi', 'the rules did not change');
});
