const _ = require('lodash');
const BPromise = require('bluebird');
const path = require('path');
const rasterMapCore = require('./raster-map-core');
const sharp = require('sharp');

function render(_opts) {
  const opts = _.merge({
    photo: 'brick-wall.jpg',
  }, _opts);

  const mapRenderOpts = _.omit(_.merge({}, opts, {
    resizeToWidth: 500,
    resizeToHeight: null,
  }), _.isNil);
  return rasterMapCore.render(mapRenderOpts)
    .then(mapImage => BPromise.props({
      photo: sharp(getFilePath(`./images/${opts.photo}`))
        .overlayWith(mapImage),
    }))
    .then(({ photo }) => {
      if (_.isFinite(opts.resizeToWidth)) {
        return photo.resize(opts.resizeToWidth, null);
      } else if (_.isFinite(opts.resizeToHeight)) {
        return photo.resize(null, opts.resizeToHeight);
      }

      return photo;
    })
    .then(photo => photo.png().toBuffer());
}

function getFilePath(relativePath) {
  return path.join(__dirname, '../../', relativePath);
}

module.exports = {
  render,
};
