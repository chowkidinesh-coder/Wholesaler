// Admin rules, stored as one JSON value. q is a function (sql, params) -> { rows }.
const DEFAULT_SETTINGS = { codMin: 5000, pincodes: [], upiId: 'test@upi', upiName: 'Wholesale Market' };

async function getSettings(q) {
  const { rows } = await q(`SELECT value FROM settings WHERE key = 'app'`);
  return { ...DEFAULT_SETTINGS, ...(rows[0] ? rows[0].value : {}) };
}

async function saveSettings(q, value) {
  await q(
    `INSERT INTO settings (key, value, updated_at) VALUES ('app', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(value)]);
}

module.exports = { DEFAULT_SETTINGS, getSettings, saveSettings };
