// Orders and their payments. Every rule (stock, prices, COD minimum, delivery PIN, who may do what) is enforced HERE,
// on the server, so changing the page in the browser cannot get around it.
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const { ApiError, wrap, parse } = require('../errors');
const { getSettings } = require('../settings');
const { ALL_STATUSES, CLOSED_STATUSES, MAX_QTY, UNPAID_HOLD_MINUTES, TEST_UPI, UUID_RE, ms, paise, rupees } = require('../util');

const ORDER_SQL = `
  SELECT o.*, COALESCE((SELECT json_agg(json_build_object('productId', i.product_id, 'name', i.name, 'price', i.price, 'qty', i.qty, 'total', i.total) ORDER BY i.position, i.id)
                        FROM order_items i WHERE i.order_id = o.id), '[]'::json) AS items
  FROM orders o`;
// A UPI order reaches the admin only after the customer has paid (or sent the UTR); before that it is just a hold on the stock
const ADMIN_VISIBLE_SQL = `(o.payment <> 'UPI' OR o.pay_status <> 'Unpaid' OR o.pay_submitted_at IS NOT NULL)`;

const orderJson = (o) => ({
  id: o.id, code: o.code, group: o.group_id, customerId: o.customer_id, customerName: o.customer_name, customerMobile: o.customer_mobile,
  ownerId: o.wholesaler_id, store: o.store, address: o.address, pincode: o.pincode, payment: o.payment, payStatus: o.pay_status,
  payRef: o.pay_ref, paySubmitted: ms(o.pay_submitted_at), paidAt: ms(o.paid_at), status: o.status, cancelledBy: o.cancelled_by,
  cancelledAt: ms(o.cancelled_at), total: Number(o.total), date: ms(o.created_at),
  items: (o.items || []).map((i) => ({ productId: i.productId, name: i.name, price: Number(i.price), qty: i.qty, total: Number(i.total) })),
});

const isClosed = (status) => CLOSED_STATUSES.includes(status);
const unpaidUpi = (o) => o.payment === 'UPI' && o.pay_status === 'Unpaid' && !isClosed(o.status);
const adminVisible = (o) => o.payment !== 'UPI' || o.pay_status !== 'Unpaid' || !!o.pay_submitted_at;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I, so a code is easy to read out
const newCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

const orderSchema = z.object({
  items: z.array(z.object({ productId: z.string().regex(UUID_RE, 'not a valid id'), qty: z.coerce.number().int().min(1).max(MAX_QTY) })).min(1).max(50),
  address: z.string().trim().min(5, 'enter your delivery address').max(200),
  pincode: z.string().trim().regex(/^\d{6}$/, 'enter a 6-digit PIN code'),
  payment: z.enum(['UPI', 'COD']),
});
const statusSchema = z.object({ status: z.enum(ALL_STATUSES) });
const payStatusSchema = z.object({ status: z.enum(['Paid', 'Unpaid']) });
const utrSchema = z.object({ utr: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8,22}$/, 'enter the UTR / transaction number from your UPI app (8 to 22 letters or digits)') });

const lockOrder = async (q, id) => {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await q('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] || null;
};
const lockGroup = async (q, groupId) => (await q('SELECT * FROM orders WHERE group_id = $1 ORDER BY created_at, code FOR UPDATE', [groupId])).rows;
const fetchOrders = async (q, ids) => (await q(`${ORDER_SQL} WHERE o.id = ANY($1::uuid[]) ORDER BY o.created_at, o.code`, [ids])).rows.map(orderJson);

// A cancelled / refused order puts its goods back on the shelf
async function restoreStock(q, orderIds) {
  if (!orderIds.length) return;
  await q(
    `UPDATE products p SET qty = p.qty + s.n
     FROM (SELECT product_id, sum(qty)::int AS n FROM order_items WHERE order_id = ANY($1::uuid[]) AND product_id IS NOT NULL GROUP BY product_id) s
     WHERE p.id = s.product_id`, [orderIds]);
}

// An unpaid UPI order only holds the stock: after UNPAID_HOLD_MINUTES it is cancelled and the stock goes back
async function expireUnpaid(db) {
  return db.tx(async (q) => {
    const { rows } = await q(
      `UPDATE orders SET status = 'Cancelled', cancelled_by = 'system', cancelled_at = now()
       WHERE payment = 'UPI' AND pay_status = 'Unpaid' AND pay_submitted_at IS NULL AND status IN ('Pending', 'Confirmed')
         AND created_at < now() - make_interval(mins => $1::int) RETURNING id`, [UNPAID_HOLD_MINUTES]);
    await restoreStock(q, rows.map((r) => r.id));
    return rows.length;
  });
}

function makeOrderRoutes({ db, requireAuth, requireAdmin }) {
  const r = express.Router();
  const requireCustomer = (req, res, next) => (req.user && req.user.role === 'customer' ? next() : next(new ApiError(req.user ? 403 : 401, req.user ? 'CUSTOMER_ONLY' : 'LOGIN_REQUIRED', req.user ? 'Only customers can do this.' : 'Please log in.')));

  r.get('/orders', requireAuth, wrap(async (req, res) => {
    await expireUnpaid(db);
    const { rows } = req.user.role === 'admin'
      ? await db.query(`${ORDER_SQL} WHERE ${ADMIN_VISIBLE_SQL} ORDER BY o.created_at DESC LIMIT 500`)
      : await db.query(`${ORDER_SQL} WHERE o.customer_id = $1 ORDER BY o.created_at DESC LIMIT 200`, [req.user.id]);
    res.json(rows.map(orderJson));
  }));

  // ---------- place an order (customer) ----------
  r.post('/orders', requireCustomer, wrap(async (req, res) => {
    const input = parse(orderSchema, req.body);
    const wanted = new Map();   // productId -> quantity (the same product twice is added up)
    for (const it of input.items) wanted.set(it.productId, (wanted.get(it.productId) || 0) + it.qty);
    if ([...wanted.values()].some((n) => n > MAX_QTY)) throw new ApiError(400, 'VALIDATION', `You can buy at most ${MAX_QTY} of one product in one order.`, 'items');
    const group = crypto.randomUUID();

    const placed = await db.tx(async (q) => {
      const settings = await getSettings(q);
      if (settings.pincodes.length && !settings.pincodes.includes(input.pincode)) throw new ApiError(400, 'PIN_NOT_ALLOWED', `Sorry, we do not deliver to PIN code ${input.pincode} yet.`, 'pincode', { pin: input.pincode });
      const ids = [...wanted.keys()];
      const { rows: prods } = await q(
        `SELECT p.id, p.name, p.price, p.qty, p.wholesaler_id, w.store FROM products p JOIN wholesalers w ON w.id = p.wholesaler_id
         WHERE p.id = ANY($1::uuid[]) ORDER BY p.id FOR UPDATE OF p`, [ids]);
      const byId = new Map(prods.map((p) => [p.id, p]));
      if (byId.size !== ids.length) throw new ApiError(409, 'PRODUCT_GONE', 'A product in your cart is no longer available.');

      // one order per wholesaler, in the order the products appear in the cart
      const shops = new Map();
      let grand = 0;
      let position = 0;
      for (const id of ids) {
        const p = byId.get(id);
        const qty = wanted.get(id);
        if (p.qty < qty) throw new ApiError(409, 'OUT_OF_STOCK', `Sorry, not enough stock left for ${p.name}.`, 'items', { name: p.name });
        const line = { productId: id, name: p.name, price: paise(p.price), qty, total: paise(p.price) * qty, position: position++ };
        grand += line.total;
        if (!shops.has(p.wholesaler_id)) shops.set(p.wholesaler_id, { store: p.store, lines: [] });
        shops.get(p.wholesaler_id).lines.push(line);
      }
      if (input.payment === 'COD' && grand < settings.codMin * 100) {
        throw new ApiError(400, 'COD_NOT_ALLOWED', `COD is available only for orders of Rs ${settings.codMin} or more. Please pay by UPI.`, 'payment', { min: `Rs ${settings.codMin}` });
      }

      const orderIds = [];
      for (const [wholesalerId, shop] of shops) {
        let code = newCode();
        while ((await q('SELECT 1 FROM orders WHERE code = $1', [code])).rows.length) code = newCode();
        const total = shop.lines.reduce((s, l) => s + l.total, 0);
        const { rows: [o] } = await q(
          `INSERT INTO orders (code, group_id, customer_id, customer_name, customer_mobile, wholesaler_id, store, address, pincode, payment, pay_status, status, total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Pending', $12) RETURNING id`,
          [code, group, req.user.id, req.user.name, req.user.mobile, wholesalerId, shop.store, input.address, input.pincode, input.payment, input.payment === 'UPI' ? 'Unpaid' : '', rupees(total)]);
        orderIds.push(o.id);
        for (const l of shop.lines) {
          await q('INSERT INTO order_items (order_id, product_id, name, price, qty, total, position) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [o.id, l.productId, l.name, rupees(l.price), l.qty, rupees(l.total), l.position]);
          await q('UPDATE products SET qty = qty - $1 WHERE id = $2', [l.qty, l.productId]);
        }
      }
      await q('UPDATE users SET address = $1, pincode = $2 WHERE id = $3', [input.address, input.pincode, req.user.id]);   // remembered for next time
      return fetchOrders(q, orderIds);
    });
    res.status(201).json({ orders: placed });
  }));

  // ---------- customer: pay, simulate a test payment, cancel ----------
  r.post('/orders/:id/pay', requireCustomer, wrap(async (req, res) => {
    const { utr } = parse(utrSchema, req.body);
    const orders = await db.tx(async (q) => {
      const base = await lockOrder(q, req.params.id);
      if (!base || base.customer_id !== req.user.id) throw new ApiError(404, 'NOT_FOUND', 'No such order.');
      const list = (await lockGroup(q, base.group_id)).filter(unpaidUpi);
      if (!list.length) throw new ApiError(409, 'NOT_WAITING', 'This order is no longer waiting for payment.');
      if ((await q('SELECT 1 FROM orders WHERE pay_ref = $1 AND group_id <> $2 LIMIT 1', [utr, base.group_id])).rows.length) throw new ApiError(409, 'UTR_USED', 'This UTR was already used for another order.', 'utr');
      const ids = list.map((o) => o.id);
      await q(`UPDATE orders SET pay_status = 'Submitted', pay_ref = $1, pay_submitted_at = now() WHERE id = ANY($2::uuid[])`, [utr, ids]);
      return fetchOrders(q, ids);
    });
    res.json({ orders });
  }));

  // Test mode (UPI ID test@upi): no real money can move, so this stands in for a payment that succeeded
  r.post('/orders/:id/test-pay', requireCustomer, wrap(async (req, res) => {
    const orders = await db.tx(async (q) => {
      if ((await getSettings(q)).upiId !== TEST_UPI) throw new ApiError(403, 'TEST_PAY_OFF', 'Test payments only work while the UPI ID is test@upi.');
      const base = await lockOrder(q, req.params.id);
      if (!base || base.customer_id !== req.user.id) throw new ApiError(404, 'NOT_FOUND', 'No such order.');
      const list = (await lockGroup(q, base.group_id)).filter(unpaidUpi);
      if (!list.length) throw new ApiError(409, 'NOT_WAITING', 'This order is no longer waiting for payment.');
      const ids = list.map((o) => o.id);
      const ref = `TEST${String(crypto.randomInt(0, 1e8)).padStart(8, '0')}`;
      await q(`UPDATE orders SET pay_status = 'Paid', pay_ref = $1, pay_submitted_at = now(), paid_at = now(),
               status = CASE WHEN status = 'Pending' THEN 'Confirmed' ELSE status END WHERE id = ANY($2::uuid[])`, [ref, ids]);
      return fetchOrders(q, ids);
    });
    res.json({ orders });
  }));

  // The customer may cancel until the order ships. An unpaid UPI order is cancelled together with the rest of its payment;
  // a paid one is cancelled on its own, and the admin is reminded to refund it.
  r.post('/orders/:id/cancel', requireCustomer, wrap(async (req, res) => {
    const out = await db.tx(async (q) => {
      const base = await lockOrder(q, req.params.id);
      if (!base || base.customer_id !== req.user.id) throw new ApiError(404, 'NOT_FOUND', 'No such order.');
      if (!['Pending', 'Confirmed'].includes(base.status)) throw new ApiError(409, 'CANNOT_CANCEL', 'This order can no longer be cancelled.');
      const list = unpaidUpi(base) && !base.pay_submitted_at ? (await lockGroup(q, base.group_id)).filter(unpaidUpi) : [base];
      const ids = list.map((o) => o.id);
      await q(`UPDATE orders SET status = 'Cancelled', cancelled_by = 'customer', cancelled_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
      await restoreStock(q, ids);
      return { orders: await fetchOrders(q, ids), needsRefund: ['Paid', 'Submitted'].includes(base.pay_status) };
    });
    res.json(out);
  }));

  // ---------- admin: status and payment ----------
  r.patch('/orders/:id/status', requireAdmin, wrap(async (req, res) => {
    const { status } = parse(statusSchema, req.body);
    const order = await db.tx(async (q) => {
      const o = await lockOrder(q, req.params.id);
      if (!o || !adminVisible(o)) throw new ApiError(404, 'NOT_FOUND', 'No such order.');
      if (isClosed(o.status)) throw new ApiError(409, 'ORDER_CLOSED', 'This order has ended and can no longer change.');
      if (o.status !== status) {
        await q('UPDATE orders SET status = $1 WHERE id = $2', [status, o.id]);
        if (isClosed(status)) await restoreStock(q, [o.id]);
      }
      return (await fetchOrders(q, [o.id]))[0];
    });
    res.json({ order });
  }));

  // Mark a UPI payment as paid (it covers every order paid together), or back to unpaid after a refund
  r.post('/orders/:id/payment', requireAdmin, wrap(async (req, res) => {
    const { status } = parse(payStatusSchema, req.body);
    const orders = await db.tx(async (q) => {
      const o = await lockOrder(q, req.params.id);
      if (!o || !adminVisible(o)) throw new ApiError(404, 'NOT_FOUND', 'No such order.');
      if (o.payment !== 'UPI') throw new ApiError(400, 'NOT_UPI', 'Only UPI orders have a payment status.');
      const ids = isClosed(o.status) ? [o.id] : (await lockGroup(q, o.group_id)).map((x) => x.id);   // a cancelled order is settled on its own
      if (status === 'Paid') {
        await q(`UPDATE orders SET pay_status = 'Paid', paid_at = now(), status = CASE WHEN status = 'Pending' THEN 'Confirmed' ELSE status END WHERE id = ANY($1::uuid[])`, [ids]);
      } else {
        await q(`UPDATE orders SET pay_status = 'Unpaid', paid_at = NULL, pay_ref = NULL WHERE id = ANY($1::uuid[])`, [ids]);   // the order stays visible to the admin
      }
      return fetchOrders(q, ids);
    });
    res.json({ orders });
  }));

  return r;
}

module.exports = { makeOrderRoutes, expireUnpaid };
