const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { ApiError, wrap } = require('./errors');
const { makeAuth } = require('./auth');
const { makeShopRoutes } = require('./routes/shop');
const { makeAdminRoutes } = require('./routes/admin');
const { makeOrderRoutes } = require('./routes/orders');
const { makePeopleRoutes } = require('./routes/people');

// Only these files of the website are served. (The server folder holds secrets such as .env and must never be reachable.)
const WEB_FILES = ['index.html', 'script.js', 'i18n.js', 'qrcode.js', 'styles.css'];

function createApp({ db, jwtSecret, webRoot, secureCookie = false, trustProxy = false, bcryptRounds = 10, loginLimit = 20, demoOtp = false, sendOtp = null, log = console }) {
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long.');
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);   // set when a hosting proxy sits in front, so the real client IP is used for rate limits
  // TODO: turn on a strict Content-Security-Policy once the page's inline theme script moves into its own file
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  const auth = makeAuth({ db, jwtSecret, secureCookie, bcryptRounds, loginLimit });
  app.use('/api', auth.attachUser);

  // Product photos travel inside the request, so only the logged-in admin may send a big one; everyone else gets the small limit
  const bigJson = express.json({ limit: '6mb' });
  app.use('/api/products', (req, res, next) => (req.user && req.user.role === 'admin' ? bigJson(req, res, next) : next()));
  app.use(express.json({ limit: '100kb' }));

  // Cross-site forms cannot send JSON, so insisting on JSON for writes blocks forged requests (the cookie is also SameSite=Lax)
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.path !== '/auth/logout' && !req.is('application/json')) return next(new ApiError(415, 'JSON_ONLY', 'Send the request as JSON.'));
    next();
  });

  app.get('/api/health', wrap(async (req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  }));
  app.use('/api/auth', auth.router);
  app.use('/api', makeShopRoutes({ db }));
  app.use('/api', makeAdminRoutes({ db, requireAdmin: auth.requireAdmin }));
  app.use('/api', makeOrderRoutes({ db, requireAuth: auth.requireAuth, requireAdmin: auth.requireAdmin }));
  app.use('/api', makePeopleRoutes({ db, requireAuth: auth.requireAuth, bcryptRounds, demoOtp, sendOtp }));

  app.get('/', (req, res) => res.sendFile(path.join(webRoot, 'index.html')));
  for (const file of WEB_FILES) app.get(`/${file}`, (req, res) => res.sendFile(path.join(webRoot, file)));

  app.use('/api', (req, res, next) => next(new ApiError(404, 'NOT_FOUND', 'No such API route.')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.field ? { field: err.field } : {}), ...(err.meta ? { meta: err.meta } : {}) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.', code: 'BAD_JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.', code: 'TOO_LARGE' });
    log.error(err);   // a real bug or the database is down: the details stay in the server log, the client gets nothing sensitive
    res.status(500).json({ error: 'Something went wrong on the server.', code: 'SERVER_ERROR' });
  });

  return { app, auth };
}

module.exports = { createApp, WEB_FILES };
