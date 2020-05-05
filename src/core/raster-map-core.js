const fs = require('fs');
const BPromise = require('bluebird');
const path = require('path');
const _ = require('lodash');
const mapnik = require('mapnik');
const logger = require('../util/logger')(__filename);
const { replacePostgisParametersFile } = require('../util/mapnik');
const config = require('../config');

BPromise.promisifyAll(fs);

mapnik.register_default_fonts();
mapnik.register_default_input_plugins();
if (config.DEBUG_MAPNIK) {
  mapnik.Logger.setSeverity(mapnik.Logger.DEBUG);
}

async function render(_opts) {
  const opts = _.merge({
    map: null,
    scale: 1,
    format: 'png32',
    stylesheetPath: path.join(config.STYLE_DIR, `${_opts.mapStyle}.xml`),
  }, _opts);

  let mapInstance;
  if (opts.map) {
    logger.info('Reusing given mapnik map instance ..');
    mapInstance = BPromise.promisifyAll(opts.map);
  } else {
    logger.info('Creating a new mapnik map instance ..');
    const newMap = BPromise.promisifyAll(new mapnik.Map(opts.width, opts.height));
    const newStyleFilePath = await replacePostgisParametersFile(opts.stylesheetPath);
    mapInstance = await newMap.loadAsync(newStyleFilePath, {
      strict: true,
    });
  }

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
  mapInstance.extent = extent;

  const image = BPromise.promisifyAll(new mapnik.Image(opts.width, opts.height));
  await mapInstance.renderAsync(image, { scale: opts.scale });
  const encoded = await image.encodeAsync(opts.format);
  return encoded;
}

module.exports = {
  render,
};
