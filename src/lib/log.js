export function safeErr(err) {
  return err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    String(err);
}

function line(level, msg, meta = {}) {
  const clean = { level, msg, ...meta };
  if (clean.token) clean.token = "[redacted]";
  if (clean.key) clean.key = "[redacted]";
  const out = JSON.stringify(clean);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export const log = {
  info: (msg, meta = {}) => line("info", msg, meta),
  warn: (msg, meta = {}) => line("warn", msg, meta),
  error: (msg, meta = {}) => line("error", msg, meta),
};
