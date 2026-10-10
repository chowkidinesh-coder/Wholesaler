// Creates the tables and the admin account. Safe to run again: it never deletes or overwrites anything.
//   npm run db:init     tables + admin
//   npm run db:demo     the same, plus a demo customer, two wholesalers and some products (for trying things out)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const bcrypt = require('bcryptjs');
const { pgAdapter, applySchema } = require('../src/db');

async function ensureAdmin(db, env, rounds = 10) {
  const { rows } = await db.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
  if (rows.length) return 'already there';
  const { ADMIN_NAME = 'Admin', ADMIN_EMAIL, ADMIN_MOBILE, ADMIN_PASSWORD } = env;
  if (!ADMIN_EMAIL || !ADMIN_MOBILE || !ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL, ADMIN_MOBILE and ADMIN_PASSWORD are missing in server/.env (npm run setup-env).');
  if (ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
  await db.query(`INSERT INTO users (role, name, email, mobile, password_hash) VALUES ('admin', $1, $2, $3, $4)`,
    [ADMIN_NAME, ADMIN_EMAIL.toLowerCase(), ADMIN_MOBILE, await bcrypt.hash(ADMIN_PASSWORD, rounds)]);
  return `created (${ADMIN_EMAIL.toLowerCase()})`;
}

// Only for trying the site out on your own computer: it adds a customer with a well-known password
async function seedDemo(db, rounds = 10) {
  const { rows } = await db.query('SELECT (SELECT count(*) FROM wholesalers) AS w, (SELECT count(*) FROM products) AS p');
  if (Number(rows[0].w) || Number(rows[0].p)) return 'skipped (there are already wholesalers or products)';
  await db.query(
    `INSERT INTO users (role, name, email, mobile, password_hash) VALUES ('customer', 'Demo Customer', 'customer@demo.com', '9000000002', $1) ON CONFLICT DO NOTHING`,
    [await bcrypt.hash('demo123', rounds)]);
  const toys = (await db.query(`INSERT INTO wholesalers (store, name, mobile) VALUES ('Happy Toys Store', 'Demo Toys Wholesaler', '9000000011') RETURNING id`)).rows[0].id;
  const stationery = (await db.query(`INSERT INTO wholesalers (store, name, mobile) VALUES ('Smart Stationery Mart', 'Demo Stationery Wholesaler', '9000000012') RETURNING id`)).rows[0].id;
  const products = [
    [toys, 'Toys', 'Toys', 'Soft, safe and cuddly toys for kids of all ages.', 100, 20, '🧸'],
    [toys, 'Building Blocks', 'Toys', 'Colourful interlocking blocks that build creativity.', 100, 12, '🧱'],
    [toys, 'Toy Cars', 'Toys', 'Pull-back toy cars in assorted colours.', 100, 8, '🚗'],
    [stationery, 'Notebooks (pack of 12)', 'Stationery', 'Ruled 200-page notebooks for school and office.', 360, 40, '📓'],
    [stationery, 'Ball Pens (box of 50)', 'Stationery', 'Smooth-writing blue ball pens.', 250, 60, '🖊️'],
    [stationery, 'Geometry Box', 'Stationery', 'Complete geometry set in a sturdy metal box.', 90, 30, '📐'],
  ];
  for (const p of products) {
    await db.query('INSERT INTO products (wholesaler_id, name, category, description, price, qty, emoji) VALUES ($1, $2, $3, $4, $5, $6, $7)', p);
  }
  return 'added (customer@demo.com / demo123, 2 wholesalers, 6 products)';
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('server/.env is missing. Run "npm run setup-env" first.');
    process.exit(1);
  }
  const db = pgAdapter(process.env.DATABASE_URL);
  try {
    await applySchema(db);
    console.log('Tables: ready');
    console.log('Admin:', await ensureAdmin(db, process.env));
    if (process.argv.includes('--demo')) console.log('Demo data:', await seedDemo(db));
  } catch (err) {
    console.error(`Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

if (require.main === module) main();

module.exports = { ensureAdmin, seedDemo };
