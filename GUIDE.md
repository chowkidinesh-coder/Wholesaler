# Wholesale Market – complete guide

Read this once from top to bottom. It tells you what the project is, how to run it on your computer, where things
live, how to change them safely, and how to send your changes back. Commands are for Windows (PowerShell or the
VS Code terminal) but work the same on Mac/Linux.

---

## 1. What this project is

A wholesale shop on the web.

- **Customers** register, browse products of several wholesalers, put them in a cart, give an address and a PIN code,
  and pay by **UPI** or **COD** (cash on delivery). They can track, cancel and review their orders.
- **The admin** (the shop owner) logs in and runs everything: adds **wholesalers** and their **products** (with photos),
  sets the **rules** (COD minimum, delivery PIN codes, UPI ID), sees **orders**, checks **UPI payments**, ships orders,
  and handles **refunds**. Wholesalers do not log in: the admin keeps their details, and messages them on WhatsApp.
- Two languages: English and Hindi (the button in the top bar).

### How the pieces fit

```
 Browser (the website)                Node.js server                  PostgreSQL
 index.html, script.js   ──/api──▶   server/src/*.js   ──SQL──▶   database "wholesale_market"
 i18n.js, styles.css       JSON       login, rules, orders           users, products, orders ...
```

- The **website** only draws screens. It asks the server for data (`GET /api/products`) and sends actions
  (`POST /api/orders`). It keeps nothing important in the browser (only the cart, the wishlist, the theme and the language).
- The **server** is the boss. It checks every rule (stock, COD minimum, delivery PIN, who may do what) **again**, so
  nobody can cheat by editing the page.
- The **database** keeps everything for good.

---

## 2. What you need installed

| Tool | Version | Check it with |
|---|---|---|
| Node.js | 20 or newer | `node -v` |
| PostgreSQL | any recent (14+) | `psql --version` (or open pgAdmin / DBeaver) |
| Git | any | `git --version` |
| A code editor | VS Code is good | |
| DBeaver or pgAdmin (optional) | | to look inside the database |

---

## 3. First-time setup (about 10 minutes)

### Step 1: get the code
Either unzip the zip you were sent, or clone the repository:
```
git clone https://github.com/chowkidinesh-coder/Wholesaler.git
cd Wholesaler
```

### Step 2: make an empty database
Open pgAdmin or DBeaver, connect to your own PostgreSQL, and run:
```sql
CREATE DATABASE wholesale_market;
```
(Or in a terminal: `createdb -U postgres wholesale_market`.)

### Step 3: install the server's packages
```
cd server
npm install
```

### Step 4: create your `.env` file
```
npm run setup-env
```
It asks, one by one:
- PostgreSQL host / port / database / user: press **Enter** to accept `localhost`, `5432`, `wholesale_market`, `postgres`.
- **Your PostgreSQL password** (what you set when you installed PostgreSQL). Typing is hidden.
- **Admin name, email, mobile number and password** for the shop. You will log in with these. Use at least 8
  characters for the password, and do not use a `"` or `\` in passwords.

It writes `server/.env`. **That file is yours only. Never commit it, never send it to anyone.**

`setup-env` also adds the line `DEMO_OTP=true`: it shows the *forgot password* code on screen, because no SMS/email
service is connected yet. Remove that line on a real server.

> If you prefer to write `.env` by hand: copy `server/.env.example` to `server/.env` and fill in the blanks.

### Step 5: create the tables and the admin account
```
npm run db:init
```
You should see `Tables: ready` and `Admin: created (your-email)`.

Optional: add a demo customer, 2 wholesalers and 6 products so there is something to click on:
```
npm run db:demo
```
(Demo customer: `customer@demo.com` / `demo123`. Only for your own computer.)

### Step 6: start it
```
npm start
```
Open **http://localhost:3000** in the browser. (Do **not** double-click `index.html`; the page needs the server.)

Stop the server any time with `Ctrl + C`. Start it again with `npm start`. After you change a file under `server/`, stop
and start the server again. After you change a website file (`script.js`, `styles.css` ...) just press `Ctrl + F5`.

---

## 4. Try it out (10-minute tour)

Use **two windows**: a normal one for the admin and a private/incognito one (`Ctrl + Shift + N`) for the customer. Each
window has its own login.

1. **Admin window:** log in with the admin email and password. You land on **Orders** (empty). Open **Wholesalers**,
   add a store. Open **Products**, add a product for that store (price, quantity, photos).
2. **Customer window:** click **Register**, make an account. Open a product, type a quantity, press **Buy now**.
   Enter an address and a 6-digit PIN code, choose **UPI**, press **Place order**.
3. A **Pay screen** opens. While the UPI ID is `test@upi` there is a **🧪 Test** button that pretends the payment worked.
   Press it. The order becomes **Paid** and **Confirmed**.
4. **Admin window:** within about 20 seconds the order appears. Press **View** to see the customer, address, items, and
   the two WhatsApp buttons (they open WhatsApp with the message already typed; you press Send).
5. Change the status to **Shipped**. On the customer window the progress bar moves.
6. **Cancel / refund:** on a new order, pay it, then press **Cancel order** as the customer. The admin gets a red alert
   "need a refund". After you refund the customer from your own UPI app, press **Mark as unpaid** in the order's window.

Money rules to know: COD is offered only when the order total is **at or above** the *COD minimum* (default Rs 5000, set in
the admin **Rules** tab). An unpaid UPI order is hidden from the admin and is cancelled by itself after 30 minutes.

---

## 5. Where things live (what to open to change what)

| I want to change ... | Open this file |
|---|---|
| Any text on the page (English or Hindi) | `i18n.js` (the `en:` and `hi:` blocks; keep the same key in both) |
| Colours, spacing, layout | `styles.css` |
| The structure of the page, forms, tabs, dialogs | `index.html` |
| What a button does, how a screen is drawn | `script.js` (sections are labelled with `// ---------- ... ----------`) |
| The QR code for UPI | `qrcode.js` (a small library, leave it alone) |
| A rule (stock, COD, PIN, permissions) | `server/src/routes/orders.js` (orders), `server/src/routes/admin.js` (products, wholesalers, rules) |
| Login, register, profile | `server/src/auth.js` |
| Forgot-password, reviews, contact form | `server/src/routes/people.js` |
| What visitors can read (products, reviews, photos) | `server/src/routes/shop.js` |
| The database tables | `server/sql/schema.sql` |
| Shared limits (max quantity, categories, 30-minute hold) | `server/src/util.js` (and the same numbers at the top of `script.js`) |
| The server's start-up and settings | `server/src/index.js`, `server/src/app.js` |

### A few ideas of how it is written (so the code feels familiar)
- `script.js` keeps a copy of what the server said in one object, `state`. Screens are drawn from `state`. After any
  action it calls the server, then `refreshData()` to get the fresh state, then draws again.
- Every call to the server goes through `api(method, path, body)`. Errors come back with a short `code`; the page shows
  the text stored under `api.<CODE>` in `i18n.js`.
- The server answers in JSON. Every route checks who is calling (`requireAuth`, `requireAdmin`) and validates the input
  with `zod` before touching the database.
- Money is kept in the database as numbers with 2 decimals and added up in paise (whole numbers) in the server, so there
  are no rounding surprises.

---

## 6. Making a change safely

1. **Make a branch** so your work is separate: `git checkout -b my-change`
2. **Change the code.** For a new feature, think "page, server, database": usually all three.
3. **Database change?** Edit `server/sql/schema.sql` in a way that is safe to run twice:
   `CREATE TABLE IF NOT EXISTS ...`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`, `CREATE INDEX IF NOT EXISTS ...`.
   Then run `npm run db:init` (it never deletes data).
4. **Run the tests:**
   ```
   cd server
   npm test
   ```
   All tests must pass (there are 56). They run on a throw-away in-memory PostgreSQL, so they never touch your real data.
   - `test/auth.test.js`: login and register.
   - `test/shop.test.js`: the API (products, orders, payments, reviews ...).
   - `test/e2e.test.js`: the real website talking to the real server in a simulated browser.
5. **Add a test for what you built.** Copy a nearby test; the helper functions at the top of each file show how.
6. **Try it by hand** in the browser, as admin and as customer.

---

## 7. Sending your changes with Git

First look at what changed:
```
git status
```
Check that `server/.env` is **not** in the list (it is in `.gitignore`, so it should not be). If you ever see it, stop and
do not commit.

Then:
```
git checkout -b my-change            # once per piece of work
git add -A
git commit -m "Short sentence about what you changed"
git push -u origin my-change         # first push of this branch
```
- The first `git push` on Windows opens a browser window to sign in to GitHub. After that it remembers you.
- On GitHub press **Compare & pull request**, describe the change, and ask the other person to review and merge.
- To get the other person's latest work: `git checkout main` then `git pull`.
- If `git push` says you do not have permission, you are not a collaborator on that repository. Ask the owner to add you
  (Settings → Collaborators), or fork the repository and push to your fork.

Your commits carry the name and email set in `git config user.name` / `git config user.email`. These show on GitHub. Set
them to what you want to show: `git config user.name "Your Name"` and `git config user.email "you@example.com"`.

**Never commit:** `server/.env`, `node_modules/`, passwords, UPI/bank details, or customer data.

---

## 8. When something does not work

| What you see | What to do |
|---|---|
| `The .env file is missing or incomplete` | Run `npm run setup-env` in the `server` folder. |
| `Could not connect to PostgreSQL ... password authentication failed` | The password in `server/.env` is wrong. Run `npm run setup-env -- --force` and enter it again. |
| `... database "wholesale_market" does not exist` | Create it (Step 2). |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL is not running. Start the PostgreSQL service. |
| `EADDRINUSE ... 3000` | Another server is already on port 3000 (maybe your old one). Stop it with `Ctrl + C` in its terminal, or set `PORT=3001` in `server/.env`. |
| The page is blank / old / half working | Press `Ctrl + F5`. Open it as `http://localhost:3000`, not from the folder. |
| "Cannot reach the server" on the page | The server is not running. `npm start` in `server`. |
| Login fails but the password is right | You may be using the demo account on a database where `npm run db:demo` was never run. Register a new customer, or log in as the admin. |
| Forgot-password says "not set up yet" | Add `DEMO_OTP=true` to `server/.env` and restart the server. |
| `Too many attempts` | The login limiter. Wait 15 minutes or restart the server. |
| A test fails after your change | Read the first failing test; the message says which line. Fix the code, or the test if you changed behaviour on purpose. |

To look inside the database: connect DBeaver/pgAdmin to `localhost:5432`, database `wholesale_market`. The most useful
tables are `users`, `wholesalers`, `products`, `orders`, `order_items`, `settings`. Passwords are stored only as hashes.

---

## 9. What is finished and what is not

**Finished:** login and register, wholesalers, products with photos, categories, search, cart, checkout with address and
PIN code, COD rules, UPI pay screen with QR and a test mode, UTR check by the admin, order tracking, cancel and refund
reminder, reviews after delivery, wishlist, receipts, English and Hindi, forgot password (demo code), contact form,
WhatsApp message buttons, automatic tests.

**Not done yet (good next jobs, in this order):**
1. **Put it online** (a small server with https). Then set `COOKIE_SECURE=true` and `TRUST_PROXY=true` in `.env`, and change
   the admin password. Until then only the computer it runs on can use it.
2. **Razorpay** (or another gateway) so UPI payments are checked and refunded automatically. Keep its secret key only on
   the server, never in `script.js`.
3. **WhatsApp Business API / SMS / email** so order messages and forgot-password codes go out by themselves (today the
   admin taps the WhatsApp buttons, and `server/src/routes/people.js` has a `sendOtp` hook ready to plug a sender in).
4. A strict **Content-Security-Policy** (move the small inline theme script in `index.html` into its own file first).
5. **Pages for long lists** (the admin order list shows the newest 500).
6. Product photos live in the database (fine for hundreds of products); move them to file storage if the shop grows.

**Safety notes:** the secret values (`.env`) stay on the computer that runs the server. A customer must never be able to
see another customer's orders or touch admin features; the tests check this, keep them passing.
