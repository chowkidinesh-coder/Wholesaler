# Wholesale Market server

Node + PostgreSQL. Run these in this folder (`server`), one time:

1. `npm install`
2. `npm run setup-env`  - asks for the PostgreSQL password and the admin login, writes `.env`
3. `npm run db:init`    - creates the tables and the admin account
4. `npm run db:demo`    - (optional) adds a demo customer, 2 wholesalers and 6 products

Every time: `npm start`, then open http://localhost:3000

`npm test` runs the automatic tests on an in-memory PostgreSQL (your real database is not touched).
`.env` holds secrets and is ignored by git. Never share it.
