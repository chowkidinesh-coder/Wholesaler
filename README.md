# Wholesale Market – version 2.0.0

A small wholesale shop: customers order from several wholesalers, pay by UPI or COD, and the admin runs everything
(wholesalers, products, rules, orders, payments, refunds). Website in plain HTML/JavaScript, server in Node.js, data in PostgreSQL.

Version 1 (the original browser-only demo) stays on the `main` branch and the `v1.0.0` tag. This is **version 2**: see [CHANGELOG.md](CHANGELOG.md).

**New here? Read [GUIDE.md](GUIDE.md) first**: setup, a tour, where to change what, tests, Git, and troubleshooting.

```
index.html, script.js, i18n.js, styles.css, qrcode.js   the website (English + Hindi)
server/                                                  the API server (Node + Express) and the database schema
  sql/schema.sql                                         every table
  src/                                                   server code (auth, products, orders, payments ...)
  test/                                                  automatic tests (they use an in-memory database)
```

## Run it on your own computer

You need **Node.js 20 or newer** and **PostgreSQL** (any recent version) installed.

1. **Make an empty database.** In pgAdmin / DBeaver, or in a terminal: `createdb wholesale_market`
   (or run `CREATE DATABASE wholesale_market;`).
2. **Install the server's packages**
   ```
   cd server
   npm install
   ```
3. **Create your `.env`** (secrets for your computer only; it is never committed)
   ```
   npm run setup-env
   ```
   It asks for your PostgreSQL password and for the admin email, mobile and password you want. For testing the
   forgot-password screen, open `server/.env` and add the line `DEMO_OTP=true` (it shows the code on screen).
4. **Create the tables and the admin account**
   ```
   npm run db:init
   npm run db:demo     # optional: a demo customer (customer@demo.com / demo123), 2 wholesalers, 6 products
   ```
5. **Start**
   ```
   npm start
   ```
   Open **http://localhost:3000** (do not open `index.html` from the folder: the page needs the server).

Log in with the admin email and password from step 3. Customers register on the page (the **Register** tab).
To test as admin and customer at the same time, use a normal window and a private/incognito window.

## Automatic tests

```
cd server
npm test
```
56 tests: login, the API, and the whole website talking to the server. They run on PostgreSQL in memory, so your real
database is never touched.

## Good to know

- **UPI test mode:** while the UPI ID (admin, *Rules* tab) is `test@upi`, the Pay screen has a "simulate payment" button.
  With a real UPI ID the customer pays in their UPI app and types the UTR; the admin checks the money and marks it paid.
- **Rules are enforced by the server** (stock, COD minimum, delivery PIN codes, who may do what). Change them in the
  admin *Rules* tab, never only in the page.
- **Not done yet:** a payment gateway (Razorpay) for automatic payment checks and refunds, WhatsApp / SMS sending by the
  server (today the admin taps the WhatsApp buttons), a strict Content-Security-Policy, and hosting it online with https
  (then set `COOKIE_SECURE=true` and `TRUST_PROXY=true` in `.env`).
- **Never commit `server/.env`** (it is in `.gitignore`) and never share it: it holds the database password and the admin login.
