/* eslint-disable no-process-env */

// Env vars should be casted to correct types
const config = {
  PORT: Number(process.env.PORT) || 5000,
  NODE_ENV: process.env.NODE_ENV,
  LOG_LEVEL: process.env.LOG_LEVEL,
  API_KEY: process.env.API_KEY,
};

if (!config.API_KEY) {
  throw new Error('Configuration error, API_KEY env var not set');
}

module.exports = config;
