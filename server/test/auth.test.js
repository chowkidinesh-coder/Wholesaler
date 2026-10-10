// Automatic tests. They run on PostgreSQL in memory (pglite): they never touch your real database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const { pgliteAdapter, applySchema } = require('../src/db');
const { createApp } = require('../src/app');
const { ensureAdmin, seedDemo } = require('../scripts/init-db');

const webRoot = path.join(__dirname, '..', '..');
const SECRET = 'test-secret-test-secret-test-secret-123';
const customer = { name: 'Asha Rao', email: 'Asha@Example.com', mobile: '98765 43210', password: 'secret1' };
let db, app, pg;

const makeApp = (extra = {}) => createApp({ db, jwtSecret: SECRET, webRoot, bcryptRounds: 4, loginLimit: 1000, log: { error() {} }, ...extra }).app;

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  pg = new PGlite();
  db = pgliteAdapter(pg);
  await applySchema(db);
  await ensureAdmin(db, { ADMIN_EMAIL: 'Boss@Shop.com', ADMIN_MOBILE: '9999999999', ADMIN_PASSWORD: 'Str0ngAdminPass' }, 4);
  app = makeApp();
});
after(async () => { await db.close(); });

test('the schema can be applied again without errors, and the default rules exist', async () => {
  await applySchema(db);
  const { rows } = await db.query(`SELECT value FROM settings WHERE key = 'app'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value.codMin, 5000);
});

test('admin account is created once and the password is stored hashed', async () => {
  assert.equal(await ensureAdmin(db, {}, 4), 'already there');
  const { rows } = await db.query(`SELECT email, password_hash FROM users WHERE role = 'admin'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'boss@shop.com');
  assert.ok(!rows[0].password_hash.includes('Str0ngAdminPass') && rows[0].password_hash.startsWith('$2'));
});

test('health check reaches the database', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('register creates a customer, logs in, and stores only a password hash', async () => {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ ...customer, role: 'admin' });   // asking to be admin must not work
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'customer');
  assert.equal(res.body.user.email, 'asha@example.com');
  assert.equal(res.body.user.mobile, '9876543210');
  assert.equal(res.body.user.password_hash, undefined);
  assert.match(res.headers['set-cookie'][0], /wm_session=.*HttpOnly.*SameSite=Lax/i);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.body.user.name, 'Asha Rao');
  const { rows } = await db.query('SELECT password_hash FROM users WHERE email = $1', ['asha@example.com']);
  assert.ok(rows[0].password_hash.startsWith('$2') && !rows[0].password_hash.includes('secret1'));
});

test('register rejects duplicates and bad input', async () => {
  let res = await request(app).post('/api/auth/register').send({ ...customer, mobile: '9123456789' });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'EMAIL_TAKEN');
  res = await request(app).post('/api/auth/register').send({ ...customer, email: 'other@example.com' });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'MOBILE_TAKEN');
  for (const bad of [{ email: 'nope' }, { mobile: '12' }, { password: '123' }, { name: '  ' }]) {
    res = await request(app).post('/api/auth/register').send({ ...customer, email: 'new@example.com', mobile: '9000000099', ...bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.body.code, 'VALIDATION');
  }
});

test('login: right password works, wrong password and unknown email give the same answer', async () => {
  let res = await request(app).post('/api/auth/login').send({ email: 'ASHA@example.com', password: 'secret1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'asha@example.com');
  const wrong = await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'wrong-one' });
  const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'secret1' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
});

test('admin can log in with the account from .env', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'boss@shop.com', password: 'Str0ngAdminPass' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'admin');
});

test('logout ends the session; a tampered or missing cookie means logged out', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'asha@example.com', password: 'secret1' });
  assert.ok((await agent.get('/api/auth/me')).body.user);
  await agent.post('/api/auth/logout').send({});
  assert.equal((await agent.get('/api/auth/me')).body.user, null);
  const forged = await request(app).get('/api/auth/me').set('Cookie', 'wm_session=not.a.real.token');
  assert.equal(forged.body.user, null);
});

test('a token signed with another secret is refused', async () => {
  const jwt = require('jsonwebtoken');
  const { rows } = await db.query(`SELECT id FROM users WHERE role = 'admin'`);
  const fake = jwt.sign({ sub: rows[0].id }, 'some-other-secret-some-other-secret-1');
  const res = await request(app).get('/api/auth/me').set('Cookie', `wm_session=${fake}`);
  assert.equal(res.body.user, null);
});

test('profile can be updated, and a mobile number taken by someone else is refused', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'asha@example.com', password: 'secret1' });
  let res = await agent.patch('/api/auth/me').send({ name: 'Asha R', mobile: '9876543210', address: '12 Main Street, Pune', pincode: '411001' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.pincode, '411001');
  res = await agent.patch('/api/auth/me').send({ name: 'Asha R', mobile: '9999999999', address: '', pincode: '' });
  assert.equal(res.status, 409);
  res = await agent.patch('/api/auth/me').send({ name: 'Asha R', mobile: '9876543210', address: '', pincode: '12' });
  assert.equal(res.status, 400);
  assert.equal((await request(app).patch('/api/auth/me').send({ name: 'x', mobile: '9876543210' })).status, 401);
});

test('password change needs the current password', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'asha@example.com', password: 'secret1' });
  let res = await agent.post('/api/auth/password').send({ current: 'nope-nope', next: 'brand-new-1' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'WRONG_PASSWORD');
  res = await agent.post('/api/auth/password').send({ current: 'secret1', next: 'brand-new-1' });
  assert.equal(res.status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'secret1' })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'brand-new-1' })).status, 200);
});

test('too many login attempts are slowed down', async () => {
  const strict = makeApp({ loginLimit: 3 });
  let last;
  for (let i = 0; i < 5; i++) last = await request(strict).post('/api/auth/login').send({ email: 'asha@example.com', password: 'wrong-wrong' });
  assert.equal(last.status, 429);
  assert.equal(last.body.code, 'TOO_MANY_ATTEMPTS');
});

test('write requests must be JSON (blocks forged form posts), bad JSON is a clean 400', async () => {
  let res = await request(app).post('/api/auth/login').type('form').send('email=asha@example.com&password=brand-new-1');
  assert.equal(res.status, 415);
  res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{not json');
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'BAD_JSON');
});

test('unknown API routes answer 404 as JSON', async () => {
  const res = await request(app).get('/api/nothing-here');
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
});

test('the website files are served, and secrets and other files are not', async () => {
  assert.equal((await request(app).get('/')).status, 200);
  for (const f of ['/index.html', '/script.js', '/i18n.js', '/qrcode.js', '/styles.css']) assert.equal((await request(app).get(f)).status, 200, f);
  for (const f of ['/server/.env', '/server/package.json', '/server/src/index.js', '/.git/config', '/.gitignore', '/%2e%2e/server/.env', '/..%2fserver%2f.env']) {
    const res = await request(app).get(f);
    assert.equal(res.status, 404, `${f} must not be served`);
  }
});

test('demo data can be added once, and is skipped the second time', async () => {
  assert.match(await seedDemo(db, 4), /^added/);
  assert.match(await seedDemo(db, 4), /^skipped/);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM products');
  assert.equal(rows[0].n, 6);
});

test('deleting a wholesaler removes its products', async () => {
  const { rows: [w] } = await db.query(`SELECT id FROM wholesalers WHERE store = 'Happy Toys Store'`);
  await db.query('DELETE FROM wholesalers WHERE id = $1', [w.id]);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM products');
  assert.equal(rows[0].n, 3);
});

test('a transaction that fails is rolled back completely', async () => {
  await assert.rejects(db.tx(async (q) => {
    await q(`INSERT INTO wholesalers (store, name, mobile) VALUES ('Temp Store', 'Temp', '9000000000')`);
    throw new Error('stop');
  }), /stop/);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM wholesalers WHERE store = 'Temp Store'`);
  assert.equal(rows[0].n, 0);
});
