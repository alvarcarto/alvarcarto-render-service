const BPromise = require('bluebird');
const path = require('path');
const _ = require('lodash');
const mapnik = require('mapnik');

mapnik.register_default_fonts();
mapnik.register_default_input_plugins();

/*
  view: {
    topLeft: { lat: .., lng: .. },
    bottomRight: { lat: .., lng: .. },
  }
*/
function render(_opts) {
  const opts = _.merge({
    scale: 1,
    format: 'png',
    stylesheetPath: path.join(__dirname, '../../styles/mapnik/bw.xml'),
  }, _opts);

  const map = BPromise.promisifyAll(new mapnik.Map(opts.width, opts.height));
  return map.loadAsync(opts.stylesheetPath, { strict: true })
    .then(() => {
      const merc = new mapnik.Projection('+init=epsg:3857');
      const coord1 = merc.forward([opts.view.topLeft.lng, opts.view.topLeft.lat]);
      const coord2 = merc.forward([opts.view.bottomRight.lng, opts.view.bottomRight.lat]);
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