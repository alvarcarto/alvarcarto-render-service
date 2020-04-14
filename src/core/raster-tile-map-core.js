const BPromise = require('bluebird');
const path = require('path');
const _ = require('lodash');
const sharp = require('sharp');
const { tile } = require('@alvarcarto/mosaic');
const logger = require('../util/logger')(__filename);
const config = require('../config');

function render(_opts) {
  const opts = _.merge({
    template: config.TILE_URL.replace(/\{style\}/g, _opts.mapStyle),
    swLat: _opts.bounds.southWest.lat,
    swLng: _opts.bounds.southWest.lng,
    neLat: _opts.bounds.northEast.lat,
    neLng: _opts.bounds.northEast.lng,
  }, _opts);

  if (opts.resizeToWidth) {
    opts.minWidth = Math.max(opts.resizeToWidth, 500);
    opts.minHeight = 0;
  } else if (opts.resizeToHeight) {
    opts.minHeight = Math.max(opts.resizeToHeight, 500);
    opts.minWidth = 0;
  }

  logger.info('Rendering map with tiles.. ');
  return tile(opts)
    .then((image) => {
      return sharp(image)
        .resize(opts.width, opts.height)
        .png()
        .toBuffer();
    });
}

module.exports = {
  render,
};
