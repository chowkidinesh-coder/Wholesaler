// Shared rules and small helpers. These match the rules the website already used.
const CATEGORIES = ['Toys', 'Stationery', 'Other'];
const OPEN_STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered'];   // the normal order flow
const CLOSED_STATUSES = ['Cancelled', 'Refused'];                         // an order that ended early can no longer change
const ALL_STATUSES = [...OPEN_STATUSES, ...CLOSED_STATUSES];
const MAX_QTY = 20;            // most units of one product a customer can buy in one order
const MAX_STOCK = 1000000;
const MAX_PRICE = 1000000;
const MAX_PHOTOS = 3;
const UNPAID_HOLD_MINUTES = 30; // an unpaid UPI order is released after this long
const TEST_UPI = 'test@upi';    // while this is the UPI ID, a "simulate payment" button works

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ms = (d) => (d ? new Date(d).getTime() : null);
const paise = (n) => Math.round(Number(n) * 100);
const rupees = (p) => p / 100;

module.exports = {
  CATEGORIES, OPEN_STATUSES, CLOSED_STATUSES, ALL_STATUSES, MAX_QTY, MAX_STOCK, MAX_PRICE, MAX_PHOTOS,
  UNPAID_HOLD_MINUTES, TEST_UPI, UUID_RE, ms, paise, rupees,
};
