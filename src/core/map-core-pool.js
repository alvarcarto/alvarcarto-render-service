const cluster = require('cluster');
const BPromise = require('bluebird');
const path = require('path');
const glob = require('glob');
const _ = require('lodash');
const mapnik = require('mapnik');
const AsyncLock = require('async-lock');
const logger = require('../util/logger')(__filename);
const {
  replacePostgisParametersFile,
  replacePostgisParametersFileSync,
  AUTOGEN_SUFFIX,
 } = require('../util/mapnik');
const config = require('../config');
const rasterMapCore = require('./map-core');

let mapnikCache = {};
if (cluster.isMaster) {
  logger.info('Skipping mapnik style preloading as this is the cluster master ..');
} else if (config.NODE_ENV !== 'production') {
  logger.info('Skipping mapnik style preloading because NODE_ENV != production (speeds boot-up) ..');
} else {
  // Pre-load and initialize map for each mapnik style
  const files = _.filter(glob.sync(`${config.STYLE_DIR}/*.xml`), filePath => !_.endsWith(filePath, `${AUTOGEN_SUFFIX}.xml`));
  logger.info(`Preloading ${files.length} mapnik styles ..`);

  mapnikCache = _.reduce(files, (memo, filePath) => {
    const styleName = path.basename(filePath, '.xml');

    const map = BPromise.promisifyAll(new mapnik.Map(500, 500));
    const autogenStylePath = replacePostgisParametersFileSync(filePath);
    map.loadSync(autogenStylePath, { strict: true });

    return _.extend({}, memo, {
      [styleName]: {
        map,
        lock: createLock(),
      },
    });
  }, {});

  logger.info('Mapnik styles loaded.');
}

function createLock() {
  return new AsyncLock({ timeout: 60000, Promise: BPromise });
}

async function generateStyleLock(styleName) {
  const styleFilePath = path.join(config.STYLE_DIR, `${styleName}.xml`);
  const map = BPromise.promisifyAll(new mapnik.Map(500, 500));

  const autogenStylePath = await replacePostgisParametersFile(styleFilePath);
  await map.loadAsync(autogenStylePath, { strict: true });
  return {
    map,
    lock: createLock(),
  };
}

async function render(_opts) {
  const opts = _.merge({}, _opts);
  const key = opts.mapStyle;

  logger.info(`Aquiring a lock with key: ${key}`);

  if (!_.has(mapnikCache, key)) {
    logger.info(`Key not found in cache: ${key}, creating new`);
    mapnikCache[key] = await generateStyleLock(key);
  }
  const { map, lock } = mapnikCache[key];
  const result = await lock.acquire(key, () => {
    logger.info(`Got lock for key: ${key}`);

    map.resize(opts.width, opts.height);
    return rasterMapCore.render(_.merge({}, opts, {
      map,
    }));
  });
  logger.info(`Released lock: ${key}`);
  return result;
}

module.exports = {
  render,
};
