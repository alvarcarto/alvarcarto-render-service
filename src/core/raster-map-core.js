const BPromise = require('bluebird');
const path = require('path');
const glob = require('glob');
const _ = require('lodash');
const mapnik = require('mapnik');
const logger = require('../util/logger')(__filename);
const config = require('../config');

mapnik.register_default_fonts();
mapnik.register_default_input_plugins();

// Pre-load and initialize map for each mapnik style
// This operation takes
let mapnikCache = {};
if (config.SKIP_INITIAL_MAPNIK_CACHE) {
  logger.info('SKIP_INITIAL_MAPNIK_CACHE=true, skipping initial mapnik caching');
} else {
  const files = glob.sync(`${config.STYLE_DIR}/*.xml`);
  logger.info(`Preloading ${files.length} mapnik styles ..`);
  mapnikCache = _.reduce(files, (memo, filePath) => {
    const styleName = path.basename(filePath, '.xml');

    const map = BPromise.promisifyAll(new mapnik.Map(100, 100));
    map.loadSync(filePath, { strict: true });
    return _.extend({}, memo, {
      [styleName]: map,
    });
  }, {});
  logger.info('Mapnik styles loaded.');
}

function render(_opts) {
  const opts = _.merge({
    scale: 1,
    format: 'png',
    // Can be used to omit mapnik cache.
    omitCache: false,
    stylesheetPath: path.join(config.STYLE_DIR, `${_opts.mapStyle}.xml`),
  }, _opts);

  const key = opts.mapStyle;
  let map;
  let mapPromise;
  if (!opts.omitCache && _.has(mapnikCache, key)) {
    logger.info(`Using cached mapnik map with key: ${key}`);
    map = mapnikCache[key];
    map.resize(opts.width, opts.height);
    mapPromise = BPromise.resolve(true);
  } else {
    logger.info(`Creating a new mapnik map instance, key: ${key}`);
    map = BPromise.promisifyAll(new mapnik.Map(opts.width, opts.height));
    mapPromise = map.loadAsync(opts.stylesheetPath, { strict: true });
  }

  return mapPromise
    .then(() => {
      mapnikCache[key] = map;
      const merc = new mapnik.Projection('+init=epsg:3857');
      /*
        bounds: {
          southWest: { lat: .., lng: .. },
          northEast: { lat: .., lng: .. },
        }
      */
      const coord1 = merc.forward([opts.bounds.southWest.lng, opts.bounds.southWest.lat]);
      const coord2 = merc.forward([opts.bounds.northEast.lng, opts.bounds.northEast.lat]);
      const extent = coord1.concat(coord2);
      map.extent = extent;

      const image = new mapnik.Image(opts.width, opts.height);
      return BPromise.props({
        map: map.renderAsync(image, { scale: opts.scale }),
        image,
      });
    })
    .then((result) => {
      const image = BPromise.promisifyAll(result.image);
      return image.encodeAsync(opts.format);
    });
}

module.exports = {
  render,
};
