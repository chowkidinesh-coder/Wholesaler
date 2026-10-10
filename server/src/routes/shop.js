// What every visitor may read: the product list, the public rules, reviews and product photos.
const express = require('express');
const { wrap, ApiError } = require('../errors');
const { getSettings } = require('../settings');
const { ms, UUID_RE } = require('../util');

const PRODUCT_SQL = `
  SELECT p.id, p.wholesaler_id, w.store, p.name, p.category, p.description, p.price, p.qty, p.emoji, p.created_at,
         COALESCE((SELECT json_agg(i.id ORDER BY i.position, i.id) FROM product_images i WHERE i.product_id = p.id), '[]'::json) AS image_ids
  FROM products p JOIN wholesalers w ON w.id = p.wholesaler_id`;

// The same shape the website always used: ownerId is the wholesaler, images are URLs
const productJson = (r) => ({
  id: r.id, ownerId: r.wholesaler_id, store: r.store, name: r.name, category: r.category, description: r.description,
  price: Number(r.price), qty: r.qty, emoji: r.emoji, images: (r.image_ids || []).map((id) => `/api/images/${id}`), created: ms(r.created_at),
});

async function listProducts(db) {
  const { rows } = await db.query(`${PRODUCT_SQL} ORDER BY p.created_at DESC, p.id`);
  return rows.map(productJson);
}

async function getProduct(db, id) {
  const { rows } = await db.query(`${PRODUCT_SQL} WHERE p.id = $1`, [id]);
  return rows[0] ? productJson(rows[0]) : null;
}

function makeShopRoutes({ db }) {
  const r = express.Router();

  r.get('/products', wrap(async (req, res) => res.json(await listProducts(db))));

  r.get('/settings', wrap(async (req, res) => res.json(await getSettings((s, p) => db.query(s, p)))));

  r.get('/reviews', wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT r.id, r.product_id, p.name AS product_name, p.wholesaler_id, r.customer_id, u.name AS customer_name, r.rating, r.comment, r.created_at, r.updated_at
       FROM reviews r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.customer_id
       ORDER BY COALESCE(r.updated_at, r.created_at) DESC`);
    res.json(rows.map((x) => ({
      id: x.id, productId: x.product_id, productName: x.product_name, ownerId: x.wholesaler_id, customerId: x.customer_id,
      customerName: x.customer_name, rating: x.rating, comment: x.comment, created: ms(x.created_at), updated: ms(x.updated_at),
    })));
  }));

  r.get('/images/:id', wrap(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'No such image.');
    const { rows } = await db.query('SELECT mime, data FROM product_images WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'No such image.');
    res.set({ 'Content-Type': rows[0].mime, 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' });   // an edited photo gets a new id
    res.send(rows[0].data);
  }));

  return r;
}

module.exports = { makeShopRoutes, listProducts, getProduct, productJson };
