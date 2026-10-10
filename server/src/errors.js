// An error the client may see: a status, a short machine code (the page translates it) and an English message.
class ApiError extends Error {
  constructor(status, code, message, field, meta) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    this.meta = meta;   // small facts the page can show in its own language, such as { name: "Blocks" }
  }
}

// Express 5 forwards rejected promises by itself; this keeps the same code working if the version ever changes
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Validate a request body with a zod schema; the first problem becomes a 400
function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue.path.join('.') || undefined;
  throw new ApiError(400, 'VALIDATION', field ? `Invalid "${field}": ${issue.message}` : issue.message, field);
}

module.exports = { ApiError, wrap, parse };
