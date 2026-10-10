// Admin only: wholesalers, products (with photos) and the rules.
const express = require('express');
const { z } = require('zod');
const { ApiError, wrap, parse } = require('../errors');
const { getSettings, saveSettings } = require('../settings');
const { getProduct } = require('./shop');
const { CATEGORIES, MAX_PRICE, MAX_STOCK, MAX_PHOTOS, UUID_RE } = require('../util');

const uuid = z.string().regex(UUID_RE, 'not a valid id');
const mobileField = z.string().transform((s) => s.replace(/[\s\-()]/g, '')).pipe(z.string().regex(/^\+?\d{10,15}$/, 'enter 10 to 15 digits, with an optional + at the start'));

const wholesalerSchema = z.object({
  store: z.string().trim().min(1, 'enter the store name').max(40),
  name: z.string().trim().min(1, 'enter the contact person').max(60),
  mobile: mobileField,
  address: z.string().trim().max(200).default(''),
});

const imageField = z.string().max(1_000_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, 'must be a JPEG, PNG or WebP picture');
const productFields = {
  wholesalerId: uuid,
  name: z.string().trim().min(1, 'enter the product name').max(40),
  category: z.enum(CATEGORIES),
  description: z.string().trim().max(300).default(''),
  price: z.coerce.number().min(0.01).max(MAX_PRICE).transform((n) => Math.round(n * 100) / 100),
};
const createProductSchema = z.object({ ...productFields, qty: z.coerce.number().int().min(1).max(MAX_STOCK), images: z.array(imageField).max(MAX_PHOTOS).default([]) });
const editProductSchema = z.object({
  ...productFields, qty: z.coerce.number().int().min(0).max(MAX_STOCK),
  keepImages: z.array(uuid).max(MAX_PHOTOS).default([]), newImages: z.array(imageField).max(MAX_PHOTOS).default([]),
});
const stockSchema = z.object({ price: productFields.price, qty: z.coerce.number().int().min(0).max(MAX_STOCK) });

const settingsSchema = z.object({
  codMin: z.coerce.number().int().min(0).max(MAX_PRICE),
  pincodes: z.array(z.string().regex(/^\d{6}$/, 'every PIN code must have 6 digits')).max(2000),
  upiId: z.string().trim().regex(/^[\w.-]{2,}@[A-Za-z][A-Za-z0-9]+$/, 'enter a valid UPI ID, like name@bank'),
  upiName: z.string().trim().max(40).default('Wholesale Market'),
});

// "data:image/png;base64,...." -> { mime, bytes }, after checking the file really is that kind of picture
function decodeImage(dataUrl) {
  const [, mime, b64] = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  const bytes = Buffer.from(b64, 'base64');
  const ok = (mime === 'image/jpeg' && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (mime === 'image/png' && bytes.length > 8 && bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
    || (mime === 'image/webp' && bytes.length > 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP');
  if (!ok) throw new ApiError(400, 'VALIDATION', 'One of the pictures is not a real JPEG, PNG or WebP file.', 'images');
  if (bytes.length > 700_000) throw new ApiError(400, 'VALIDATION', 'A picture is too big. Use a smaller photo.', 'images');
  return { mime, bytes };
}

const isDuplicate = (err) => err && err.code === '23505';

function makeAdminRoutes({ db, requireAdmin }) {
  const r = express.Router();

  // ---------- wholesalers ----------
  const wholesalerJson = (w) => ({ id: w.id, store: w.store, name: w.name, mobile: w.mobile, address: w.address, created: new Date(w.created_at).getTime() });

  r.get('/wholesalers', requireAdmin, wrap(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM wholesalers ORDER BY created_at, id');
    res.json(rows.map(wholesalerJson));
  }));

  r.post('/wholesalers', requireAdmin, wrap(async (req, res) => {
    const w = parse(wholesalerSchema, req.body);
    try {
      const { rows } = await db.query('INSERT INTO wholesalers (store, name, mobile, address) VALUES ($1, $2, $3, $4) RETURNING *', [w.store, w.name, w.mobile, w.address]);
      res.status(201).json(wholesalerJson(rows[0]));
    } catch (err) {
      if (isDuplicate(err)) throw new ApiError(409, 'STORE_TAKEN', `"${w.store}" is already added.`, 'store');
      throw err;
    }
  }));

  r.put('/wholesalers/:id', requireAdmin, wrap(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'No such wholesaler.');
    const w = parse(wholesalerSchema, req.body);
    try {
      // old orders keep the shop name they were placed under; product cards pick up the new name by themselves
      const { rows } = await db.query('UPDATE wholesalers SET store = $1, name = $2, mobile = $3, address = $4 WHERE id = $5 RETURNING *', [w.store, w.name, w.mobile, w.address, req.params.id]);
      if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'No such wholesaler.');
      res.json(wholesalerJson(rows[0]));
    } catch (err) {
      if (isDuplicate(err)) throw new ApiError(409, 'STORE_TAKEN', `"${w.store}" is already added.`, 'store');
      throw err;
    }
  }));

  r.delete('/wholesalers/:id', requireAdmin, wrap(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'No such wholesaler.');
    const { rowCount } = await db.query('DELETE FROM wholesalers WHERE id = $1', [req.params.id]);   // its products go too; past orders stay
    if (!rowCount) throw new ApiError(404, 'NOT_FOUND', 'No such wholesaler.');
    res.json({ ok: true });
  }));

  // ---------- products ----------
  const insertImages = async (q, productId, images, startAt) => {
    let position = startAt;
    for (const dataUrl of images) {
      const { mime, bytes } = decodeImage(dataUrl);
      await q('INSERT INTO product_images (product_id, position, mime, data) VALUES ($1, $2, $3, $4)', [productId, position++, mime, bytes]);
    }
  };
  const mapProductError = (err, name) => {
    if (isDuplicate(err)) return new ApiError(409, 'PRODUCT_EXISTS', `"${name}" is already added for this wholesaler.`, 'name');
    if (err && err.code === '23503') return new ApiError(404, 'NOT_FOUND', 'No such wholesaler.', 'wholesalerId');
    return err;
  };

  r.post('/products', requireAdmin, wrap(async (req, res) => {
    const p = parse(createProductSchema, req.body);
    try {
      const id = await db.tx(async (q) => {
        const { rows } = await q(
          'INSERT INTO products (wholesaler_id, name, category, description, price, qty) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [p.wholesalerId, p.name, p.category, p.description, p.price, p.qty]);
        await insertImages(q, rows[0].id, p.images, 0);
        return rows[0].id;
      });
      res.status(201).json(await getProduct(db, id));
    } catch (err) { throw mapProductError(err, p.name); }
  }));

  r.put('/products/:id', requireAdmin, wrap(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'No such product.');
    const p = parse(editProductSchema, req.body);
    if (p.keepImages.length + p.newImages.length > MAX_PHOTOS) throw new ApiError(400, 'VALIDATION', `A product can have at most ${MAX_PHOTOS} photos.`, 'images');
    try {
      const found = await db.tx(async (q) => {
        const { rows } = await q(
          'UPDATE products SET wholesaler_id = $1, name = $2, category = $3, description = $4, price = $5, qty = $6 WHERE id = $7 RETURNING id',
          [p.wholesalerId, p.name, p.category, p.description, p.price, p.qty, req.params.id]);
        if (!rows[0]) return false;
        const { rows: have } = await q('SELECT id FROM product_images WHERE product_id = $1', [req.params.id]);
        const haveIds = new Set(have.map((x) => x.id));
        if (p.keepImages.some((id) => !haveIds.has(id))) throw new ApiError(400, 'VALIDATION', 'A photo you wanted to keep does not belong to this product.', 'keepImages');
        await q('DELETE FROM product_images WHERE product_id = $1 AND id <> ALL($2::uuid[])', [req.params.id, p.keepImages]);
        for (let i = 0; i < p.keepImages.length; i++) await q('UPDATE product_images SET position = $1 WHERE id = $2', [i, p.keepImages[i]]);
        await insertImages(q, req.params.id, p.newImages, p.keepImages.length);
        return true;
      });
      if (!found) throw new ApiError(404, 'NOT_FOUND', 'No such product.');
      res.json(await getProduct(db, req.params.id));
    } catch (err) { throw mapProductError(err, p.name); }
  }));

  r.patch('/products/:id/stock', requireAdmin, wrap(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'No such product.');
    const { price, qty } = parse(stockSchema, req.body);
    const { rowCount } = await db.query('UPDATE products SET price = $1, qty = $2 WHERE id = $3', [price, qty, req.params.id]);
    if (!rowCount) throw new ApiError(404, 'NOT_FOUND', 'No such product.');
    res.json(await getProduct(db, req.params.id));
  }));

  r.delete('/products/:id', requireAdmin, wrap(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'No such product.');
    const { rowCount } = await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    if (!rowCount) throw new ApiError(404, 'NOT_FOUND', 'No such product.');
    res.json({ ok: true });
  }));

  // ---------- rules ----------
  r.put('/settings', requireAdmin, wrap(async (req, res) => {
    const s = parse(settingsSchema, req.body);
    const q = (sql, params) => db.query(sql, params);
    await saveSettings(q, { codMin: s.codMin, pincodes: [...new Set(s.pincodes)], upiId: s.upiId, upiName: s.upiName || 'Wholesale Market' });
    res.json(await getSettings(q));
  }));

  return r;
}

module.exports = { makeAdminRoutes };
