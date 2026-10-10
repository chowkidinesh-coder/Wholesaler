const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { pgAdapter } = require('./db');
const { createApp } = require('./app');
const { expireUnpaid } = require('./routes/orders');

async function main() {
  const { DATABASE_URL, JWT_SECRET } = process.env;
  if (!DATABASE_URL || !JWT_SECRET) {
    console.error('The .env file is missing or incomplete. Run "npm run setup-env" in the server folder first.');
    process.exit(1);
  }
  const db = pgAdapter(DATABASE_URL);
  try {
    await db.query('SELECT 1');
  } catch (err) {
    console.error(`Could not connect to PostgreSQL: ${err.message}`);
    console.error('Check that PostgreSQL is running and that DATABASE_URL in server/.env is right (user, password, database name).');
    process.exit(1);
  }
  const { app } = createApp({
    db,
    jwtSecret: JWT_SECRET,
    webRoot: path.join(__dirname, '..', '..'),
    secureCookie: process.env.COOKIE_SECURE === 'true',
    trustProxy: process.env.TRUST_PROXY === 'true',
    demoOtp: process.env.DEMO_OTP === 'true',   // local testing only: shows the forgot-password code on screen
  });
  setInterval(() => expireUnpaid(db).catch((err) => console.error('expireUnpaid failed:', err.message)), 60 * 1000);
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Wholesale Market is running: http://localhost:${port}`));
}

main();
