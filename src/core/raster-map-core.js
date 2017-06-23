const BPromise = require('bluebird');
const path = require('path');
const _ = require('lodash');
const mapnik = require('mapnik');
const config = require('../config');

mapnik.register_default_fonts();
mapnik.register_default_input_plugins();

/*
  bounds: {
    southWest: { lat: .., lng: .. },
    northEast: { lat: .., lng: .. },
  }
*/

const mapnikCache = {};

function render(_opts) {
  const opts = _.merge({
    scale: 1,
    format: 'png',
    stylesheetPath: path.join(config.STYLE_DIR, `${_opts.mapStyle}.xml`),
  }, _opts);

  const key = `${opts.width}-${opts.height}-${opts.stylesheetPath}`;
  let map;
  let mapPromise;
  if (_.has(mapnikCache, key)) {
    mapPromise = BPromise.resolve(mapnikCache[key]);
  } else {
    map = BPromise.promisifyAll(new mapnik.Map(opts.width, opts.height));
    mapPromise = map.loadAsync(opts.stylesheetPath, { strict: true });
  }

  return mapPromise
    .then(() => {
      mapnikCache[key] = map;
      const merc = new mapnik.Projection('+init=epsg:3857');
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
