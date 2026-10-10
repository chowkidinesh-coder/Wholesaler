// Login, register, profile. A session is a signed token in an httpOnly cookie (the page's JavaScript cannot read it).
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { ApiError, wrap, parse } = require('./errors');

const COOKIE = 'wm_session';
const SESSION_DAYS = 14;

const normMobile = (s) => String(s ?? '').replace(/[\s\-()]/g, '');
const publicUser = (u) => ({ id: u.id, role: u.role, name: u.name, email: u.email, mobile: u.mobile, address: u.address, pincode: u.pincode });

const mobileField = z.string().transform(normMobile).pipe(z.string().regex(/^\+?\d{10,15}$/, 'enter 10 to 15 digits, with an optional + at the start'));
const emailField = z.string().trim().toLowerCase().pipe(z.string().email('enter a valid email address').max(120));
const passwordField = z.string().min(6, 'use at least 6 characters').max(100);

const registerSchema = z.object({ name: z.string().trim().min(1, 'enter your name').max(60), email: emailField, mobile: mobileField, password: passwordField });
const loginSchema = z.object({ email: emailField, password: z.string().min(1).max(100) });
const profileSchema = z.object({
  name: z.string().trim().min(1, 'enter your name').max(60),
  mobile: mobileField,
  address: z.string().trim().max(200).default(''),
  pincode: z.string().trim().regex(/^(\d{6})?$/, 'enter a 6-digit PIN code').default(''),
});
const passwordSchema = z.object({ current: z.string().min(1).max(100), next: passwordField });

function makeAuth({ db, jwtSecret, secureCookie = false, bcryptRounds = 10, loginLimit = 20 }) {
  // A fixed hash to compare against when the email is unknown, so "no such user" and "wrong password" take the same time
  const dummyHash = bcrypt.hashSync('not-a-real-password', bcryptRounds);

  const setSession = (res, user) => {
    const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: `${SESSION_DAYS}d` });
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: SESSION_DAYS * 864e5, path: '/' });
  };

  // Runs on every request: puts the logged-in user (read fresh from the database) on req.user, or null
  const attachUser = wrap(async (req, res, next) => {
    req.user = null;
    const token = req.cookies && req.cookies[COOKIE];
    if (token) {
      try {
        const { sub } = jwt.verify(token, jwtSecret);
        const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [sub]);
        req.user = rows[0] || null;
      } catch { /* expired or tampered token: treat as logged out */ }
    }
    next();
  });

  const requireAuth = (req, res, next) => (req.user ? next() : next(new ApiError(401, 'LOGIN_REQUIRED', 'Please log in.')));
  const requireAdmin = (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'LOGIN_REQUIRED', 'Please log in.'));
    if (req.user.role !== 'admin') return next(new ApiError(403, 'ADMIN_ONLY', 'Only the admin can do this.'));
    next();
  };

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: loginLimit, standardHeaders: true, legacyHeaders: false,
    handler: (req, res, next) => next(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Try again in a few minutes.')),
  });

  const router = express.Router();

  router.post('/register', limiter, wrap(async (req, res) => {
    const { name, email, mobile, password } = parse(registerSchema, req.body);   // the role is never read from the request: always a customer
    const taken = await db.query('SELECT (SELECT count(*) FROM users WHERE lower(email) = $1) AS e, (SELECT count(*) FROM users WHERE mobile = $2) AS m', [email, mobile]);
    if (Number(taken.rows[0].e)) throw new ApiError(409, 'EMAIL_TAKEN', 'That email is already registered.', 'email');
    if (Number(taken.rows[0].m)) throw new ApiError(409, 'MOBILE_TAKEN', 'That mobile number is already registered.', 'mobile');
    const hash = await bcrypt.hash(password, bcryptRounds);
    let user;
    try {
      ({ rows: [user] } = await db.query(
        `INSERT INTO users (role, name, email, mobile, password_hash) VALUES ('customer', $1, $2, $3, $4) RETURNING *`,
        [name, email, mobile, hash]));
    } catch (err) {   // two people registering the same email at the same moment
      if (err.code === '23505') throw new ApiError(409, /mobile/.test(err.constraint || err.message) ? 'MOBILE_TAKEN' : 'EMAIL_TAKEN', 'That email or mobile number is already registered.');
      throw err;
    }
    setSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  }));

  router.post('/login', limiter, wrap(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const { rows } = await db.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : dummyHash);
    if (!user || !ok) throw new ApiError(401, 'INVALID_LOGIN', 'No account matches that email and password.');
    setSession(res, user);
    res.json({ user: publicUser(user) });
  }));

  router.post('/logout', (req, res) => {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: secureCookie, path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

  router.patch('/me', requireAuth, wrap(async (req, res) => {
    const { name, mobile, address, pincode } = parse(profileSchema, req.body);
    const clash = await db.query('SELECT 1 FROM users WHERE mobile = $1 AND id <> $2', [mobile, req.user.id]);
    if (clash.rows.length) throw new ApiError(409, 'MOBILE_TAKEN', 'That mobile number is already registered.', 'mobile');
    const { rows: [user] } = await db.query('UPDATE users SET name = $1, mobile = $2, address = $3, pincode = $4 WHERE id = $5 RETURNING *', [name, mobile, address, pincode, req.user.id]);
    res.json({ user: publicUser(user) });
  }));

  router.post('/password', requireAuth, limiter, wrap(async (req, res) => {
    const { current, next } = parse(passwordSchema, req.body);
    if (!(await bcrypt.compare(current, req.user.password_hash))) throw new ApiError(400, 'WRONG_PASSWORD', 'Your current password is incorrect.', 'current');
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(next, bcryptRounds), req.user.id]);
    res.json({ ok: true });
  }));

  return { router, attachUser, requireAuth, requireAdmin };
}

module.exports = { makeAuth, normMobile, publicUser };
