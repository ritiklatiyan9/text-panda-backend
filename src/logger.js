// Tiny structured-ish logger. Keeps dependencies minimal while giving us
// leveled, timestamped output.
const ts = () => new Date().toISOString();

export const logger = {
  info: (...args) => console.log(ts(), "INFO ", ...args),
  warn: (...args) => console.warn(ts(), "WARN ", ...args),
  error: (...args) => console.error(ts(), "ERROR", ...args),
  debug: (...args) => {
    if (process.env.DEBUG) console.log(ts(), "DEBUG", ...args);
  },
};
