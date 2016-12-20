const BPromise = require('bluebird');
const sharp = require('sharp');
const svgCore = require('./svg-core');
const logger = require('../util/logger')(__filename);

function addLabels(mapSharp) {
  logger.info('Adding labels');

  return mapSharp.metadata()
    .then((metadata) => {
      const gradientHeight = 0.2 * metadata.height;
      const gradient = loadGradientSharp(metadata.width, gradientHeight);
      const labels = loadLabelsSharp(metadata.width, gradientHeight);
      return BPromise.props({
        gradient: gradient.toBuffer(),
        labels: labels.toBuffer(),
        metadata,
        gradientHeight,
      });
    })
    .then((result) => {
      const { labels, gradient, metadata, gradientHeight } = result;
      return BPromise.props({
        poster: mapSharp
          .overlayWith(gradient, { left: 0, top: metadata.height - gradientHeight })
          .raw()
          .toBuffer(),
        labels,
        metadata,
        gradientHeight,
      });
    })
    .then((result) => {
      const { poster, labels, metadata, gradientHeight } = result;
      return sharp(poster, {
        density: 300,
        raw: {
          width: metadata.width,
          height: metadata.height,
          channels: 4,
        },
      })
        .overlayWith(labels, { left: 0, top: metadata.height - gradientHeight })
        .quality(100)
        .png()
        .toBuffer();
    });
}

function loadGradientSharp(width, height) {
  const buf = new Buffer(svgCore.whiteGradient(width, height));
  return sharp(buf, { density: 300 })
    .resize(width, height)
    .quality(100)
    .png();
}

function loadLabelsSharp(width, height) {
  const buf = new Buffer(svgCore.labels({
    width,
    height,
    fontSize: 240,
    header: 'HELSINKI',
  }));
  return sharp(buf, { density: 300 })
    .resize(width, height)
    .quality(100)
    .png();
}

module.exports = {
  addLabels,
};
