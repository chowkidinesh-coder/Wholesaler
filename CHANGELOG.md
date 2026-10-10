# Changelog

## 2.0.0 – Node + PostgreSQL version

Version 1 was a browser-only demo: everything was kept in the browser's own memory, wholesalers had their own logins,
and nothing was shared between devices. Version 2 is a real shop with a server and a database.

### New
- **Server (Node.js + Express) and PostgreSQL database** (`server/`). Data is shared by every device. Passwords are stored hashed.
- **Admin panel** (Orders, Wholesalers, Products, Rules, Reviews). The admin adds wholesalers and their products;
  wholesalers no longer log in.
- **Rules enforced on the server**: stock, COD minimum, delivery PIN codes, who may do what.
- **Payments**: UPI pay screen with QR code and a test mode, UTR check by the admin, COD (only above a minimum amount).
  An unpaid UPI order is hidden from the admin and released after 30 minutes.
- **Orders**: one order per wholesaler from a single cart, status tracking, cancel by the customer until it ships,
  refund reminder for the admin, WhatsApp message buttons with an invoice text.
- **Categories** Toys and Stationery, quantity typed in a number box, product photos (stored in the database).
- Forgot password with a code (shown on screen in local testing mode), contact form saved in the database.
- **56 automatic tests**, including the whole website talking to the server in a simulated browser.
- Setup guide: `GUIDE.md`; clean `.env.example`; `npm run setup-env`, `npm run db:init`, `npm run db:demo`.

### Changed
- Login is by email and password for everyone (no role picker). Customers register on the page; the admin account is created by `npm run db:init`.
- Minimum password length is 6 characters (it was 4).
- The page must be opened through the server (`http://localhost:3000`), not as a file.

### Removed
- Wholesaler accounts and the browser-only storage of products, orders and users.

## 1.0.0 – browser-only demo (the original code, `Initial commit`)
