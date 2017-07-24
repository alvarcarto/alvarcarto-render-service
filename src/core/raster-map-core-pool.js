const BPromise = require('bluebird');
const path = require('path');
const fs = require('fs');
const glob = require('glob');
const _ = require('lodash');
const mapnik = require('mapnik');
const mapnikPool = require('mapnik-pool')(mapnik);
const logger = require('../util/logger')(__filename);
const config = require('../config');
const rasterMapCore = require('./raster-map-core');

// Pre-load and initialize map for each mapnik style
const files = glob.sync(`${config.STYLE_DIR}/*.xml`);
logger.info(`Preloading ${files.length} mapnik styles ..`);

const mapnikCache = _.reduce(files, (memo, filePath) => {
  const styleName = path.basename(filePath, '.xml');

  const pool = mapnikPool.fromString(fs.readFileSync(filePath, 'utf8'), { size: 256 }, {
    base: config.STYLE_DIR,
  });
  return _.extend({}, memo, {
    [styleName]: BPromise.promisifyAll(pool),
  });
}, {});

logger.info('Mapnik styles loaded.');

function render(_opts) {
  const opts = _.merge({}, _opts);
  const key = opts.mapStyle;

  logger.info(`Aquiring a mapnik map from pool with key: ${key}`);

  const pool = mapnikCache[key];
  return pool.acquireAsync()
    .then(map => rasterMapCore.render(_.merge({}, opts, {
      map,
    })));
}

module.exports = {
  render,
};
