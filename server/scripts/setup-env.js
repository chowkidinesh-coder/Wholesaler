// Creates server/.env by asking a few questions in the terminal. Passwords are typed hidden and go ONLY into that file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const envPath = path.join(__dirname, '..', '.env');

function ask(question, { hidden = false, fallback = '' } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (text) => process.stdout.write(text.includes(question) ? text : '*');
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim() || fallback);
    });
  });
}

async function main() {
  if (fs.existsSync(envPath) && !process.argv.includes('--force')) {
    console.log('server/.env already exists, so nothing was changed. (Run with --force to make a new one.)');
    return;
  }
  console.log('Setting up server/.env (nothing you type here is shown or saved anywhere else).\n');
  const host = await ask('PostgreSQL host [localhost]: ', { fallback: 'localhost' });
  const port = await ask('PostgreSQL port [5432]: ', { fallback: '5432' });
  const dbName = await ask('Database name [wholesale_market]: ', { fallback: 'wholesale_market' });
  const dbUser = await ask('PostgreSQL user [postgres]: ', { fallback: 'postgres' });
  const dbPass = await ask('PostgreSQL password (hidden): ', { hidden: true });
  if (!dbPass) { console.error('A password is needed.'); process.exit(1); }
  const unsafe = /["\\\r\n]/;   // a quote, a backslash or a line break would break the .env file
  if (unsafe.test(dbPass)) { console.error('The password must not contain a double quote or a backslash.'); process.exit(1); }

  console.log('\nNow the admin account of the shop (you will log in with this):');
  const adminName = await ask('Admin name [Admin]: ', { fallback: 'Admin' });
  const adminEmail = (await ask('Admin email: ')).toLowerCase();
  const adminMobile = (await ask('Admin mobile number (10 digits): ')).replace(/[\s\-()]/g, '');
  const adminPass = await ask('Admin password (hidden, at least 8 characters): ', { hidden: true });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) { console.error('That is not a valid email.'); process.exit(1); }
  if (!/^\+?\d{10,15}$/.test(adminMobile)) { console.error('That is not a valid mobile number.'); process.exit(1); }
  if (adminPass.length < 8) { console.error('The admin password must be at least 8 characters.'); process.exit(1); }
  if (unsafe.test(adminPass)) { console.error('The admin password must not contain a double quote or a backslash.'); process.exit(1); }

  const url = `postgres://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPass)}@${host}:${port}/${encodeURIComponent(dbName)}`;
  const quote = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = [
    '# Secrets for this computer only. Never share this file or put it in git.',
    `DATABASE_URL=${quote(url)}`,
    `JWT_SECRET=${crypto.randomBytes(48).toString('hex')}`,
    'PORT=3000',
    '# Set to true once the site runs on https:// (a real domain)',
    'COOKIE_SECURE=false',
    '# Local testing only: shows the forgot-password code on screen. Remove this line on a real server.',
    'DEMO_OTP=true',
    `ADMIN_NAME=${quote(adminName)}`,
    `ADMIN_EMAIL=${quote(adminEmail)}`,
    `ADMIN_MOBILE=${quote(adminMobile)}`,
    `ADMIN_PASSWORD=${quote(adminPass)}`,
    '',
  ];
  fs.writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
  console.log('\nDone: server/.env was created. Next: npm run db:init');
}

main();
