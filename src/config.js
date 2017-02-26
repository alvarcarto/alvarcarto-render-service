/* eslint-disable no-process-env */

const path = require('path');
const logger = require('./util/logger')(__filename);

// Env vars should be casted to correct types
const config = {
  PORT: Number(process.env.PORT) || 5000,
  NODE_ENV: process.env.NODE_ENV,
  LOG_LEVEL: process.env.LOG_LEVEL,
  API_KEY: process.env.API_KEY,
  STYLE_DIR: process.env.STYLE_DIR || path.join('../alvarcarto-cartocss-bw'),
};

logger.info(`Using style directory: ${config.STYLE_DIR}`);

if (!config.API_KEY) {
  throw new Error('Configuration error, API_KEY env var not set');
}

module.exports = config;
