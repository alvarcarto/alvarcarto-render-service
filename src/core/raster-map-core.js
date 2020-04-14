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

function render(_opts) {
  const opts = _.merge({
    map: null,
    scale: 1,
    format: 'png32',
    stylesheetPath: path.join(config.STYLE_DIR, `${_opts.mapStyle}.xml`),
  }, _opts);

  let mapInstance;
  let mapPromise;
  if (opts.map) {
    logger.info('Reusing given mapnik map instance ..');
    mapInstance = BPromise.promisifyAll(opts.map);
    mapPromise = BPromise.resolve(mapInstance);
  } else {
    logger.info('Creating a new mapnik map instance ..');
    mapInstance = BPromise.promisifyAll(new mapnik.Map(opts.width, opts.height));

    mapPromise = replacePostgisParametersFile(opts.stylesheetPath)
      .then(newFilePath => mapInstance.loadAsync(newFilePath, {
        strict: true,
      }));
  }

  return mapPromise
    .then(() => {
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

      const image = new mapnik.Image(opts.width, opts.height);
      return BPromise.props({
        map: mapInstance.renderAsync(image, {
          scale: opts.scale,
        }),
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
