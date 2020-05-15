/* eslint-disable no-process-env */

const path = require('path');
const _ = require('lodash');

// Env vars should be casted to correct types
const config = {
  PORT: Number(process.env.PORT) || 5000,
  NODE_ENV: process.env.NODE_ENV,
  LOG_LEVEL: process.env.LOG_LEVEL,
  API_KEY: process.env.API_KEY,
  STYLE_DIR: process.env.STYLE_DIR || '/home/alvar/mapnik-styles',
  BACKGROUNDS_DIR: process.env.BACKGROUNDS_DIR || path.join(__dirname, '../tmp-downloads'),
  // Guessing: this must be under posters/dist to allow svg to reference the font files
  //           it was not verified as there were multiple issues with the fonts at the same time, see
  //           https://github.com/lovell/sharp/issues/2195
  FONT_DIR: path.join(__dirname, '../posters/dist/fonts'),
  DEBUG_POSTER_LINES: process.env.DEBUG_POSTER_LINES === 'true',
  SKIP_INITIAL_MAPNIK_CACHE: process.env.SKIP_INITIAL_MAPNIK_CACHE === 'true',
  SAVE_TEMP_FILES: process.env.SAVE_TEMP_FILES === 'true',
  DEBUG_MAPNIK: process.env.DEBUG_MAPNIK === 'true',
  MAPNIK_POSTGIS_DBNAME: process.env.MAPNIK_POSTGIS_DBNAME,
  MAPNIK_POSTGIS_HOST: process.env.MAPNIK_POSTGIS_HOST,
  MAPNIK_POSTGIS_PORT: process.env.MAPNIK_POSTGIS_PORT,
  MAPNIK_POSTGIS_USER: process.env.MAPNIK_POSTGIS_USER,
  MAPNIK_POSTGIS_PASSWORD: process.env.MAPNIK_POSTGIS_PASSWORD,
  CLUSTER_INSTANCES: Number(process.env.CLUSTER_INSTANCES) || 1,
  TILE_URL: process.env.TILE_URL || 'https://tile-api.alvarcarto.com/tiles/{style}/{z}/{x}/{y}/tile.png',
};

if (process.env.SKIP_ENV_CHECKS !== 'true') {
  if (!config.API_KEY) {
    throw new Error('Configuration error, API_KEY env var not set');
  }
  if (_.endsWith(config.FONT_DIR, '/')) {
    throw new Error('Configuration error, FONT_DIR must not have trailing slash');
  }
  if (_.endsWith(config.STYLE_DIR, '/')) {
    throw new Error('Configuration error, STYLE_DIR must not have trailing slash');
  }
  if (!config.TILE_URL) {
    throw new Error('Configuration error, TILE_URL env var not set');
  }
}

module.exports = config;
