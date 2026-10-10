// Products, wholesalers, rules, orders, payments, reviews, contact and forgot-password, end to end through the HTTP API
// on PostgreSQL in memory (pglite). Your real database is not touched.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const { pgliteAdapter, applySchema } = require('../src/db');
const { createApp } = require('../src/app');
const { ensureAdmin } = require('../scripts/init-db');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64')}`;
let db, pg, app, admin, cust, cust2;

const makeAgent = async (email, password) => {
  const a = request.agent(app);
  const res = await a.post('/api/auth/login').send({ email, password });
  assert.equal(res.status, 200, `login ${email}`);
  return a;
};
const register = async (n) => {
  const a = request.agent(app);
  const res = await a.post('/api/auth/register').send({ name: `Customer ${n}`, email: `c${n}@example.com`, mobile: `98000000${String(n).padStart(2, '0')}`, password: 'secret1' });
  assert.equal(res.status, 201);
  return a;
};
const mkWholesaler = async (store) => (await admin.post('/api/wholesalers').send({ store, name: `${store} owner`, mobile: '9111111111' })).body;
const mkProduct = async (w, name, price, qty, extra = {}) => (await admin.post('/api/products').send({ wholesalerId: w.id, name, category: 'Toys', price, qty, ...extra })).body;
const stockOf = async (id) => (await db.query('SELECT qty FROM products WHERE id = $1', [id])).rows[0].qty;
const place = (agent, items, extra = {}) => agent.post('/api/orders').send({ items, address: '12 Main Street, Pune', pincode: '411001', payment: 'UPI', ...extra });

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  pg = new PGlite();
  db = pgliteAdapter(pg);
  await applySchema(db);
  await ensureAdmin(db, { ADMIN_EMAIL: 'boss@shop.com', ADMIN_MOBILE: '9999999999', ADMIN_PASSWORD: 'Str0ngAdminPass' }, 4);
  app = createApp({ db, jwtSecret: 'test-secret-test-secret-test-secret-123', webRoot: path.join(__dirname, '..', '..'), bcryptRounds: 4, loginLimit: 10000, log: { error() {} } }).app;
  admin = await makeAgent('boss@shop.com', 'Str0ngAdminPass');
  cust = await register(1);
  cust2 = await register(2);
});
after(async () => { await db.close(); });

test('only the admin can change wholesalers, products and rules', async () => {
  for (const [method, url, body] of [['post', '/api/wholesalers', {}], ['get', '/api/wholesalers'], ['post', '/api/products', {}], ['put', '/api/settings', {}]]) {
    assert.equal((await request(app)[method](url).send(body)).status, 401, `${method} ${url} without login`);
    assert.equal((await cust[method](url).send(body)).status, 403, `${method} ${url} as customer`);
  }
});

test('wholesalers: add, no duplicate store, validate, edit, delete', async () => {
  const w = await admin.post('/api/wholesalers').send({ store: 'Happy Toys', name: 'Ravi', mobile: '98765 43210', address: 'Pune' });
  assert.equal(w.status, 201);
  assert.equal(w.body.mobile, '9876543210');
  assert.equal((await admin.post('/api/wholesalers').send({ store: 'happy TOYS', name: 'X', mobile: '9876543211' })).body.code, 'STORE_TAKEN');
  assert.equal((await admin.post('/api/wholesalers').send({ store: 'Z', name: 'Z', mobile: '12' })).status, 400);
  const edit = await admin.put(`/api/wholesalers/${w.body.id}`).send({ store: 'Happy Toys Ltd', name: 'Ravi K', mobile: '9876543210', address: '' });
  assert.equal(edit.body.store, 'Happy Toys Ltd');
  assert.equal((await admin.put('/api/wholesalers/00000000-0000-4000-8000-000000000000').send({ store: 'Q', name: 'Q', mobile: '9876543210' })).status, 404);
  assert.equal((await admin.get('/api/wholesalers')).body.length, 1);
  assert.equal((await admin.delete(`/api/wholesalers/${w.body.id}`)).status, 200);
  assert.equal((await admin.get('/api/wholesalers')).body.length, 0);
});

test('products: add with photos, public list, photo download, edit photos, stock, delete', async () => {
  const w = await mkWholesaler('Photo Store');
  const bad = await admin.post('/api/products').send({ wholesalerId: w.id, name: 'Bad', category: 'Toys', price: 10, qty: 5, images: ['data:image/png;base64,aGVsbG8gd29ybGQ='] });
  assert.equal(bad.status, 400, 'text pretending to be a PNG');
  assert.equal((await admin.post('/api/products').send({ wholesalerId: w.id, name: 'Bad', category: 'Weapons', price: 10, qty: 5 })).status, 400);
  assert.equal((await admin.post('/api/products').send({ wholesalerId: w.id, name: 'Bad', category: 'Toys', price: 0, qty: 5 })).status, 400);
  assert.equal((await admin.post('/api/products').send({ wholesalerId: w.id, name: 'Bad', category: 'Toys', price: 10, qty: 5, images: [PNG, PNG, PNG, PNG] })).status, 400, 'four photos');

  const p = await admin.post('/api/products').send({ wholesalerId: w.id, name: 'Robot', category: 'Toys', description: 'Walks', price: 199.999, qty: 7, images: [PNG, JPG] });
  assert.equal(p.status, 201);
  assert.equal(p.body.price, 200);
  assert.equal(p.body.store, 'Photo Store');
  assert.equal(p.body.images.length, 2);
  assert.equal((await admin.post('/api/products').send({ wholesalerId: w.id, name: 'ROBOT', category: 'Toys', price: 5, qty: 1 })).body.code, 'PRODUCT_EXISTS');

  const list = await request(app).get('/api/products');   // no login needed to browse
  assert.equal(list.status, 200);
  assert.equal(list.body.find((x) => x.id === p.body.id).name, 'Robot');
  const img = await request(app).get(p.body.images[0]);
  assert.equal(img.status, 200);
  assert.equal(img.headers['content-type'], 'image/png');
  assert.ok(img.body.length > 20);
  assert.equal((await request(app).get('/api/images/not-an-id')).status, 404);

  const keepId = p.body.images[1].split('/').pop();
  const edited = await admin.put(`/api/products/${p.body.id}`).send({ wholesalerId: w.id, name: 'Robot 2', category: 'Other', description: '', price: 250, qty: 9, keepImages: [keepId], newImages: [PNG] });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.images.length, 2);
  assert.equal(edited.body.images[0].split('/').pop(), keepId, 'kept photo comes first');
  assert.equal((await request(app).get(p.body.images[0])).status, 404, 'the removed photo is gone');
  assert.equal((await admin.put(`/api/products/${p.body.id}`).send({ wholesalerId: w.id, name: 'Robot 2', category: 'Other', price: 250, qty: 9, keepImages: [crypto.randomUUID()], newImages: [] })).status, 400, 'keeping a photo that is not this product\'s');

  const quick = await admin.patch(`/api/products/${p.body.id}/stock`).send({ price: 300, qty: 0 });
  assert.equal(quick.body.price, 300);
  assert.equal(quick.body.qty, 0);
  assert.equal((await admin.patch(`/api/products/${p.body.id}/stock`).send({ price: -1, qty: 0 })).status, 400);
  assert.equal((await admin.delete(`/api/products/${p.body.id}`)).status, 200);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM product_images WHERE product_id = $1', [p.body.id])).rows[0].n, 0, 'photos go with the product');
});

test('a normal visitor cannot send a huge request', async () => {
  const big = 'x'.repeat(200 * 1024);
  const res = await cust.post('/api/contact').send({ name: 'a', email: 'a@b.co', subject: 'order', message: big });
  assert.equal(res.status, 413);
});

test('rules: everyone can read them, only the admin can change them, bad values are refused', async () => {
  const pub = await request(app).get('/api/settings');
  assert.equal(pub.body.codMin, 5000);
  assert.equal(pub.body.upiId, 'test@upi');
  assert.equal((await admin.put('/api/settings').send({ codMin: -5, pincodes: [], upiId: 'test@upi' })).status, 400);
  assert.equal((await admin.put('/api/settings').send({ codMin: 100, pincodes: ['12'], upiId: 'test@upi' })).status, 400);
  assert.equal((await admin.put('/api/settings').send({ codMin: 100, pincodes: [], upiId: 'bad id' })).status, 400);
  const ok = await admin.put('/api/settings').send({ codMin: 300, pincodes: ['411001', '411002', '411001'], upiId: 'test@upi', upiName: '' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.pincodes, ['411001', '411002']);
  assert.equal(ok.body.codMin, 300);
  assert.equal(ok.body.upiName, 'Wholesale Market');
});

test('placing an order: validation, stock, PIN list, COD minimum, one order per wholesaler', async () => {
  const w1 = await mkWholesaler('Order Shop A');
  const w2 = await mkWholesaler('Order Shop B');
  const a = await mkProduct(w1, 'Blocks', 100, 10);
  const b = await mkProduct(w2, 'Pens', 250, 5);

  assert.equal((await request(app).post('/api/orders').send({ items: [{ productId: a.id, qty: 1 }], address: '12 Main St', pincode: '411001', payment: 'UPI' })).status, 401);
  assert.equal((await place(admin, [{ productId: a.id, qty: 1 }])).status, 403, 'the admin does not place orders');
  assert.equal((await place(cust, [])).status, 400);
  assert.equal((await place(cust, [{ productId: a.id, qty: 0 }])).status, 400);
  assert.equal((await place(cust, [{ productId: a.id, qty: 21 }])).status, 400, 'more than 20 of one product');
  assert.equal((await place(cust, [{ productId: a.id, qty: 1 }], { pincode: '12' })).status, 400);
  assert.equal((await place(cust, [{ productId: a.id, qty: 1 }], { address: 'x' })).status, 400);
  const pin = await place(cust, [{ productId: a.id, qty: 1 }], { pincode: '999999' });
  assert.equal(pin.status, 400);
  assert.equal(pin.body.code, 'PIN_NOT_ALLOWED');
  const noStock = await place(cust, [{ productId: b.id, qty: 6 }]);
  assert.equal(noStock.status, 409);
  assert.equal(noStock.body.code, 'OUT_OF_STOCK');
  assert.equal((await place(cust, [{ productId: crypto.randomUUID(), qty: 1 }])).body.code, 'PRODUCT_GONE');
  const smallCod = await place(cust, [{ productId: a.id, qty: 1 }], { payment: 'COD' });   // Rs 100 < the COD minimum of Rs 300
  assert.equal(smallCod.body.code, 'COD_NOT_ALLOWED');
  assert.equal(await stockOf(a.id), 10, 'failed orders do not touch the stock');

  const ok = await place(cust, [{ productId: a.id, qty: 2 }, { productId: b.id, qty: 3 }, { productId: a.id, qty: 1 }]);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.orders.length, 2, 'one order per wholesaler');
  assert.equal(ok.body.orders[0].group, ok.body.orders[1].group);
  const oa = ok.body.orders.find((o) => o.store === 'Order Shop A');
  const ob = ok.body.orders.find((o) => o.store === 'Order Shop B');
  assert.equal(oa.total, 300);
  assert.equal(oa.items[0].qty, 3, 'the same product twice is added up');
  assert.equal(ob.total, 750);
  assert.match(oa.code, /^[A-Z2-9]{6}$/);
  assert.equal(oa.payStatus, 'Unpaid');
  assert.equal(await stockOf(a.id), 7);
  assert.equal(await stockOf(b.id), 2);
  const me = (await cust.get('/api/auth/me')).body.user;
  assert.equal(me.address, '12 Main Street, Pune');
  assert.equal(me.pincode, '411001', 'address is remembered');

  const cod = await place(cust, [{ productId: b.id, qty: 1 }], { payment: 'COD' });   // Rs 250 < 300
  assert.equal(cod.status, 400);
  const cod2 = await place(cust, [{ productId: b.id, qty: 2 }], { payment: 'COD' });  // Rs 500 >= 300
  assert.equal(cod2.status, 201);
  assert.equal(cod2.body.orders[0].payStatus, '');
  assert.equal(cod2.body.orders[0].payment, 'COD');
  await admin.put('/api/settings').send({ codMin: 5000, pincodes: [], upiId: 'test@upi', upiName: 'Wholesale Market' });
});

test('an unpaid UPI order is hidden from the admin until it is paid; customers only see their own orders', async () => {
  const w = await mkWholesaler('Visibility Shop');
  const p = await mkProduct(w, 'Kite', 100, 10);
  const o = (await place(cust, [{ productId: p.id, qty: 1 }])).body.orders[0];
  const adminList = (await admin.get('/api/orders')).body;
  assert.ok(!adminList.some((x) => x.id === o.id), 'unpaid UPI order is not in the admin list');
  assert.equal((await admin.patch(`/api/orders/${o.id}/status`).send({ status: 'Confirmed' })).status, 404);
  assert.ok((await cust.get('/api/orders')).body.some((x) => x.id === o.id));
  assert.ok(!(await cust2.get('/api/orders')).body.some((x) => x.id === o.id), 'another customer does not see it');
  assert.equal((await cust2.post(`/api/orders/${o.id}/cancel`).send({})).status, 404);
  assert.equal((await cust2.post(`/api/orders/${o.id}/pay`).send({ utr: 'ABCDEFGH1234' })).status, 404);
  assert.equal((await request(app).get('/api/orders')).status, 401);
});

test('UPI: UTR makes the order visible, the admin marks it paid and it is confirmed; UTRs cannot be reused', async () => {
  const w = await mkWholesaler('Pay Shop');
  const p = await mkProduct(w, 'Ball', 100, 10);
  const o = (await place(cust, [{ productId: p.id, qty: 1 }])).body.orders[0];
  assert.equal((await cust.post(`/api/orders/${o.id}/pay`).send({ utr: '12' })).status, 400);
  const sent = await cust.post(`/api/orders/${o.id}/pay`).send({ utr: 'abcd12345678' });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.orders[0].payStatus, 'Submitted');
  assert.equal(sent.body.orders[0].payRef, 'ABCD12345678');
  assert.equal((await cust.post(`/api/orders/${o.id}/pay`).send({ utr: 'ZZZZ12345678' })).body.code, 'NOT_WAITING');
  const seen = (await admin.get('/api/orders')).body.find((x) => x.id === o.id);
  assert.equal(seen.payStatus, 'Submitted');
  assert.equal(seen.status, 'Pending');

  const o2 = (await place(cust2, [{ productId: p.id, qty: 1 }])).body.orders[0];
  assert.equal((await cust2.post(`/api/orders/${o2.id}/pay`).send({ utr: 'ABCD12345678' })).body.code, 'UTR_USED');

  const paid = await admin.post(`/api/orders/${o.id}/payment`).send({ status: 'Paid' });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.orders[0].payStatus, 'Paid');
  assert.equal(paid.body.orders[0].status, 'Confirmed', 'paid orders are confirmed by themselves');
  assert.equal((await cust.post(`/api/orders/${o.id}/payment`).send({ status: 'Paid' })).status, 403, 'a customer cannot mark an order paid');
  const cod = (await place(cust, [{ productId: p.id, qty: 5 }], { payment: 'COD' }));
  assert.equal(cod.status, 400);   // Rs 500 is below the default Rs 5000 minimum
});

test('test mode: simulate a payment pays and confirms every order of the cart, and switches off with a real UPI ID', async () => {
  const w1 = await mkWholesaler('Test Pay A');
  const w2 = await mkWholesaler('Test Pay B');
  const a = await mkProduct(w1, 'Item A', 100, 10);
  const b = await mkProduct(w2, 'Item B', 100, 10);
  const placed = (await place(cust, [{ productId: a.id, qty: 1 }, { productId: b.id, qty: 1 }])).body.orders;
  const res = await cust.post(`/api/orders/${placed[0].id}/test-pay`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.orders.length, 2, 'both orders of the cart are paid together');
  for (const o of res.body.orders) {
    assert.equal(o.payStatus, 'Paid');
    assert.equal(o.status, 'Confirmed');
    assert.match(o.payRef, /^TEST\d{8}$/);
  }
  assert.ok((await admin.get('/api/orders')).body.some((x) => x.id === placed[0].id), 'now the admin sees them');

  const c = await mkProduct(w1, 'Item C', 100, 10);
  const o3 = (await place(cust, [{ productId: c.id, qty: 1 }])).body.orders[0];
  await admin.put('/api/settings').send({ codMin: 5000, pincodes: [], upiId: 'shop@okaxis', upiName: 'Shop' });
  const off = await cust.post(`/api/orders/${o3.id}/test-pay`).send({});
  assert.equal(off.status, 403);
  assert.equal(off.body.code, 'TEST_PAY_OFF');
  await admin.put('/api/settings').send({ codMin: 5000, pincodes: [], upiId: 'test@upi', upiName: 'Wholesale Market' });
});

test('cancelling: unpaid cancels the whole payment, paid cancels one order and asks for a refund, shipped cannot be cancelled', async () => {
  const w1 = await mkWholesaler('Cancel A');
  const w2 = await mkWholesaler('Cancel B');
  const a = await mkProduct(w1, 'Cancel Item A', 100, 10);
  const b = await mkProduct(w2, 'Cancel Item B', 100, 10);

  const unpaid = (await place(cust, [{ productId: a.id, qty: 2 }, { productId: b.id, qty: 3 }])).body.orders;
  assert.equal(await stockOf(a.id), 8);
  const c1 = await cust.post(`/api/orders/${unpaid[0].id}/cancel`).send({});
  assert.equal(c1.status, 200);
  assert.equal(c1.body.needsRefund, false);
  assert.equal(c1.body.orders.length, 2, 'unpaid orders of one payment are cancelled together');
  assert.ok(c1.body.orders.every((o) => o.status === 'Cancelled' && o.cancelledBy === 'customer'));
  assert.equal(await stockOf(a.id), 10);
  assert.equal(await stockOf(b.id), 10);
  assert.equal((await cust.post(`/api/orders/${unpaid[0].id}/cancel`).send({})).body.code, 'CANNOT_CANCEL');

  const paid = (await place(cust, [{ productId: a.id, qty: 1 }, { productId: b.id, qty: 1 }])).body.orders;
  await cust.post(`/api/orders/${paid[0].id}/test-pay`).send({});
  const c2 = await cust.post(`/api/orders/${paid[0].id}/cancel`).send({});
  assert.equal(c2.body.needsRefund, true);
  assert.equal(c2.body.orders.length, 1, 'a paid order is cancelled on its own');
  const adminView = (await admin.get('/api/orders')).body;
  assert.equal(adminView.find((o) => o.id === paid[0].id).status, 'Cancelled');
  assert.equal(adminView.find((o) => o.id === paid[1].id).status, 'Confirmed');
  assert.equal(adminView.find((o) => o.id === paid[0].id).cancelledBy, 'customer');
  // after the refund the admin sets only that order back to unpaid
  const un = await admin.post(`/api/orders/${paid[0].id}/payment`).send({ status: 'Unpaid' });
  assert.equal(un.body.orders.length, 1);
  assert.equal(un.body.orders[0].payStatus, 'Unpaid');
  assert.equal((await admin.get('/api/orders')).body.find((o) => o.id === paid[0].id).payStatus, 'Unpaid', 'it stays visible to the admin');
  assert.equal((await admin.get('/api/orders')).body.find((o) => o.id === paid[1].id).payStatus, 'Paid');

  const shipped = (await admin.patch(`/api/orders/${paid[1].id}/status`).send({ status: 'Shipped' })).body.order;
  assert.equal(shipped.status, 'Shipped');
  assert.equal((await cust.post(`/api/orders/${paid[1].id}/cancel`).send({})).body.code, 'CANNOT_CANCEL');
});

test('admin status changes: stock returns on cancel / refuse, closed orders cannot change', async () => {
  const w = await mkWholesaler('Status Shop');
  const p = await mkProduct(w, 'Status Item', 1000, 20);
  const cod = (await place(cust, [{ productId: p.id, qty: 6 }], { payment: 'COD' })).body.orders[0];   // Rs 6000 >= the Rs 5000 minimum
  assert.equal(await stockOf(p.id), 14);
  assert.equal((await admin.patch(`/api/orders/${cod.id}/status`).send({ status: 'Nonsense' })).status, 400);
  assert.equal((await cust.patch(`/api/orders/${cod.id}/status`).send({ status: 'Shipped' })).status, 403);
  assert.equal((await admin.patch(`/api/orders/${cod.id}/status`).send({ status: 'Shipped' })).body.order.status, 'Shipped');
  const refused = await admin.patch(`/api/orders/${cod.id}/status`).send({ status: 'Refused' });
  assert.equal(refused.body.order.status, 'Refused');
  assert.equal(await stockOf(p.id), 20, 'refused goods go back on the shelf');
  assert.equal((await admin.patch(`/api/orders/${cod.id}/status`).send({ status: 'Pending' })).body.code, 'ORDER_CLOSED');
  assert.equal(await stockOf(p.id), 20);
});

test('an unpaid UPI order is released after 30 minutes and its stock goes back', async () => {
  const w = await mkWholesaler('Expiry Shop');
  const p = await mkProduct(w, 'Expiry Item', 100, 10);
  const o = (await place(cust, [{ productId: p.id, qty: 4 }])).body.orders[0];
  const fresh = (await place(cust2, [{ productId: p.id, qty: 1 }])).body.orders[0];
  assert.equal(await stockOf(p.id), 5);
  await db.query(`UPDATE orders SET created_at = now() - interval '31 minutes' WHERE id = $1`, [o.id]);
  const list = (await cust.get('/api/orders')).body;
  assert.equal(list.find((x) => x.id === o.id).status, 'Cancelled');
  assert.equal(list.find((x) => x.id === o.id).cancelledBy, 'system');
  assert.equal(await stockOf(p.id), 9, 'only the old order is released');
  assert.equal((await cust2.get('/api/orders')).body.find((x) => x.id === fresh.id).status, 'Pending');
  // an order whose UTR was sent is not released
  const sent = (await place(cust, [{ productId: p.id, qty: 1 }])).body.orders[0];
  await cust.post(`/api/orders/${sent.id}/pay`).send({ utr: 'KEEP12345678' });
  await db.query(`UPDATE orders SET created_at = now() - interval '2 hours' WHERE id = $1`, [sent.id]);
  assert.equal((await cust.get('/api/orders')).body.find((x) => x.id === sent.id).status, 'Pending');
});

test('reviews: only after delivery, can be changed and deleted, names are public', async () => {
  const w = await mkWholesaler('Review Shop');
  const p = await mkProduct(w, 'Review Item', 1000, 20);
  assert.equal((await cust.put(`/api/products/${p.id}/review`).send({ rating: 5, comment: 'great' })).body.code, 'NOT_PURCHASED');
  const o = (await place(cust, [{ productId: p.id, qty: 6 }], { payment: 'COD' })).body.orders[0];
  assert.equal((await cust.put(`/api/products/${p.id}/review`).send({ rating: 5 })).status, 403, 'ordered but not delivered');
  await admin.patch(`/api/orders/${o.id}/status`).send({ status: 'Delivered' });
  assert.equal((await cust.put(`/api/products/${p.id}/review`).send({ rating: 6 })).status, 400);
  const ok = await cust.put(`/api/products/${p.id}/review`).send({ rating: 5, comment: 'great' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.review.customerName, 'Customer 1');
  const changed = await cust.put(`/api/products/${p.id}/review`).send({ rating: 4, comment: 'good' });
  assert.equal(changed.body.review.rating, 4);
  assert.equal((await cust2.put(`/api/products/${p.id}/review`).send({ rating: 1 })).status, 403, 'someone who did not buy it');
  const pub = (await request(app).get('/api/reviews')).body.filter((r) => r.productId === p.id);
  assert.equal(pub.length, 1);
  assert.equal(pub[0].ownerId, w.id);
  assert.equal(pub[0].comment, 'good');
  await cust.delete(`/api/products/${p.id}/review`).send();
  assert.equal((await request(app).get('/api/reviews')).body.filter((r) => r.productId === p.id).length, 0);
});

test('contact form saves a message and gives a reference', async () => {
  const res = await request(app).post('/api/contact').send({ name: 'Visitor', email: 'v@example.com', subject: 'order', message: 'Where is my order please?' });
  assert.equal(res.status, 201);
  assert.match(res.body.ref, /^[A-F0-9]{6}$/);
  assert.equal((await request(app).post('/api/contact').send({ name: 'V', email: 'v@example.com', subject: 'order', message: 'short' })).status, 400);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM contact_messages')).rows[0].n, 1);
});

test('forgot password: wrong code, expiry, too many tries, and a correct code sets the new password', async () => {
  const demo = createApp({ db, jwtSecret: 'test-secret-test-secret-test-secret-123', webRoot: path.join(__dirname, '..', '..'), bcryptRounds: 4, loginLimit: 10000, demoOtp: true, log: { error() {} } }).app;
  assert.equal((await request(app).post('/api/auth/reset/request').send({ channel: 'email', identifier: 'c1@example.com' })).body.code, 'OTP_NOT_CONFIGURED', 'no code is shown unless DEMO_OTP is on');
  assert.equal((await request(demo).post('/api/auth/reset/request').send({ channel: 'email', identifier: 'ghost@example.com' })).status, 404);
  const asked = await request(demo).post('/api/auth/reset/request').send({ channel: 'mobile', identifier: '98000000 01' });
  assert.equal(asked.status, 200);
  assert.match(asked.body.demoOtp, /^\d{6}$/);
  assert.match(asked.body.sentTo, /^98\*+01$/);
  const verify = (otp, pw = 'new-pass-1') => request(demo).post('/api/auth/reset/verify').send({ channel: 'mobile', identifier: '9800000001', otp, newPassword: pw });
  const wrong = await verify(asked.body.demoOtp === '000000' ? '111111' : '000000');
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'OTP_WRONG');
  assert.equal((await verify(asked.body.demoOtp, '123')).status, 400, 'new password too short');
  const done = await verify(asked.body.demoOtp);
  assert.equal(done.status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'c1@example.com', password: 'new-pass-1' })).status, 200);
  assert.equal((await verify(asked.body.demoOtp)).body.code, 'OTP_REQUIRED', 'a code works only once');

  const again = await request(demo).post('/api/auth/reset/request').send({ channel: 'mobile', identifier: '9800000001' });
  const real = again.body.demoOtp;
  const bad = real === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await verify(bad)).status, 400);
  assert.equal((await verify(real)).body.code, 'OTP_TOO_MANY');

  const third = await request(demo).post('/api/auth/reset/request').send({ channel: 'mobile', identifier: '9800000001' });
  await db.query(`UPDATE password_resets SET expires_at = now() - interval '1 minute'`);
  assert.equal((await verify(third.body.demoOtp)).body.code, 'OTP_EXPIRED');
});
