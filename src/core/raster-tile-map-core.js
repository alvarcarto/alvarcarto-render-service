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

  const requestedWidth = opts.width;
  const requestedHeight = opts.height;
  if (opts.resizeToWidth) {
    opts.width = opts.resizeToWidth || requestedWidth;
    opts.height = Math.round((opts.width / requestedWidth) * opts.height);
  } else if (opts.resizeToHeight) {
    opts.height = opts.resizeToHeight || requestedHeight;
    opts.width = Math.round((opts.height / requestedHeight) * opts.width);
  }

  logger.info('Rendering map with tiles.. ');
  return tile(opts)
    .then(async (image) => {
      const meta = await sharp(image, { limitInputPixels: false }).metadata();
      logger.info(`Received stiched map with dimensions: ${meta.width}x${meta.height}`);
      return image;
    });
}

module.exports = {
  render,
};
