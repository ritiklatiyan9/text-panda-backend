// ---------------------------------------------------------------------------
// Central error handler + 404. Converts thrown errors into clean JSON. Errors
// can carry a `.status` (HTTP code) and `.retryAfter` (seconds) which we honour.
// ---------------------------------------------------------------------------
import { logger } from "../logger.js";

export function notFound(req, res) {
  res.status(404).json({ error: "not_found", message: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line no-unused-vars  (Express needs the 4-arg signature)
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) logger.error(err.stack || err.message);
  else logger.warn(`[${status}] ${err.message}`);

  if (err.retryAfter) res.set("Retry-After", String(err.retryAfter));

  res.status(status).json({
    error: err.code || (status >= 500 ? "internal_error" : "request_error"),
    message: status >= 500 ? "Something went wrong." : err.message,
    ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}),
  });
}
