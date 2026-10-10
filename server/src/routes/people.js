// Reviews, the contact form and forgot-password.
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { ApiError, wrap, parse } = require('../errors');
const { UUID_RE, ms } = require('../util');

const reviewSchema = z.object({ rating: z.coerce.number().int().min(1, 'choose 1 to 5 stars').max(5, 'choose 1 to 5 stars'), comment: z.string().trim().max(500).default('') });
const contactSchema = z.object({
  name: z.string().trim().min(1, 'enter your name').max(60),
  email: z.string().trim().toLowerCase().pipe(z.string().email('enter a valid email address').max(120)),
  subject: z.enum(['order', 'product', 'account', 'feedback', 'other']),
  message: z.string().trim().min(10, 'write at least 10 characters').max(1000),
});

const OTP_MINUTES = 5;
const OTP_MAX_TRIES = 5;
const normMobile = (s) => String(s ?? '').replace(/[\s\-()]/g, '');
const resetRequestSchema = z.object({ channel: z.enum(['email', 'mobile']), identifier: z.string().trim().min(3).max(120) });
const resetVerifySchema = z.object({
  channel: z.enum(['email', 'mobile']), identifier: z.string().trim().min(3).max(120),
  otp: z.string().trim().regex(/^\d{6}$/, 'enter the 6-digit code'), newPassword: z.string().min(6, 'use at least 6 characters').max(100),
});
const maskEmail = (e) => e.replace(/^(.).*(@.*)$/, '$1***$2');
const maskMobile = (m) => m.slice(0, 2) + '*'.repeat(Math.max(0, m.length - 4)) + m.slice(-2);

function makePeopleRoutes({ db, requireAuth, bcryptRounds = 10, demoOtp = false, sendOtp = null }) {
  const r = express.Router();
  const slow = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
    handler: (req, res, next) => next(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Try again in a few minutes.')),
  });

  // ---------- reviews ----------
  const reviewJson = (x) => ({ id: x.id, productId: x.product_id, productName: x.product_name, ownerId: x.wholesaler_id, customerId: x.customer_id, customerName: x.customer_name, rating: x.rating, comment: x.comment, created: ms(x.created_at), updated: ms(x.updated_at) });
  const getReview = async (productId, customerId) => (await db.query(
    `SELECT r.*, p.name AS product_name, p.wholesaler_id, u.name AS customer_name FROM reviews r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.customer_id
     WHERE r.product_id = $1 AND r.customer_id = $2`, [productId, customerId])).rows[0];

  // Only a customer whose order with this product was delivered may write a review (an existing review can always be changed)
  r.put('/products/:id/review', requireAuth, wrap(async (req, res) => {
    if (req.user.role !== 'customer') throw new ApiError(403, 'CUSTOMER_ONLY', 'Only customers can write reviews.');
    if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'No such product.');
    const { rating, comment } = parse(reviewSchema, req.body);
    const product = (await db.query('SELECT 1 FROM products WHERE id = $1', [req.params.id])).rows[0];
    if (!product) throw new ApiError(404, 'NOT_FOUND', 'No such product.');
    const had = await getReview(req.params.id, req.user.id);
    if (!had) {
      const bought = await db.query(
        `SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.product_id = $1 AND o.customer_id = $2 AND o.status = 'Delivered' LIMIT 1`, [req.params.id, req.user.id]);
      if (!bought.rows.length) throw new ApiError(403, 'NOT_PURCHASED', 'You can review a product after your order with it has been delivered.');
    }
    await db.query(
      `INSERT INTO reviews (product_id, customer_id, rating, comment) VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, customer_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()`,
      [req.params.id, req.user.id, rating, comment]);
    res.json({ review: reviewJson(await getReview(req.params.id, req.user.id)) });
  }));

  r.delete('/products/:id/review', requireAuth, wrap(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'No such product.');
    await db.query('DELETE FROM reviews WHERE product_id = $1 AND customer_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));

  // ---------- contact form ----------
  r.post('/contact', slow, wrap(async (req, res) => {
    const m = parse(contactSchema, req.body);
    const { rows } = await db.query('INSERT INTO contact_messages (user_id, name, email, subject, message) VALUES ($1, $2, $3, $4, $5) RETURNING id', [req.user ? req.user.id : null, m.name, m.email, m.subject, m.message]);
    res.status(201).json({ ref: rows[0].id.replace(/-/g, '').slice(-6).toUpperCase() });
  }));

  // ---------- forgot password ----------
  // Real SMS / email sending needs a provider (sendOtp). Until one is set up, DEMO_OTP=true shows the code in the answer (local testing only).
  const findUser = async (channel, identifier) => {
    const { rows } = channel === 'email'
      ? await db.query('SELECT * FROM users WHERE lower(email) = $1', [identifier.toLowerCase()])
      : await db.query('SELECT * FROM users WHERE mobile = $1', [normMobile(identifier)]);
    return rows[0];
  };

  r.post('/auth/reset/request', slow, wrap(async (req, res) => {
    const { channel, identifier } = parse(resetRequestSchema, req.body);
    const user = await findUser(channel, identifier);
    if (!user) throw new ApiError(404, 'NO_ACCOUNT', 'No account found with those details.');
    if (!demoOtp && !sendOtp) throw new ApiError(501, 'OTP_NOT_CONFIGURED', 'Sending codes is not set up yet. Please contact the shop.');
    const otp = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    await db.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
    await db.query(`INSERT INTO password_resets (user_id, code_hash, channel, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4::int))`,
      [user.id, await bcrypt.hash(otp, bcryptRounds), channel, OTP_MINUTES]);
    if (sendOtp) await sendOtp({ user, channel, otp });
    const sentTo = channel === 'email' ? maskEmail(user.email) : maskMobile(user.mobile);
    res.json({ sentTo, expiresInMinutes: OTP_MINUTES, ...(demoOtp ? { demoOtp: otp } : {}) });
  }));

  r.post('/auth/reset/verify', slow, wrap(async (req, res) => {
    const { channel, identifier, otp, newPassword } = parse(resetVerifySchema, req.body);
    const user = await findUser(channel, identifier);
    const reset = user && (await db.query('SELECT *, expires_at < now() AS expired FROM password_resets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [user.id])).rows[0];
    if (!reset) throw new ApiError(400, 'OTP_REQUIRED', 'Please request a code first.');
    if (reset.expired) { await db.query('DELETE FROM password_resets WHERE id = $1', [reset.id]); throw new ApiError(410, 'OTP_EXPIRED', 'The code expired. Request a new one.'); }
    if (reset.tries >= OTP_MAX_TRIES) { await db.query('DELETE FROM password_resets WHERE id = $1', [reset.id]); throw new ApiError(429, 'OTP_TOO_MANY', 'Too many wrong attempts. Request a new code.'); }
    if (!(await bcrypt.compare(otp, reset.code_hash))) {
      await db.query('UPDATE password_resets SET tries = tries + 1 WHERE id = $1', [reset.id]);
      throw new ApiError(400, 'OTP_WRONG', `Incorrect code. ${OTP_MAX_TRIES - reset.tries - 1} attempt(s) left.`, undefined, { n: OTP_MAX_TRIES - reset.tries - 1 });
    }
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(newPassword, bcryptRounds), user.id]);
    await db.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
    res.json({ ok: true });
  }));

  return r;
}

module.exports = { makePeopleRoutes };
