const BPromise = require('bluebird');
const _ = require('lodash');
const glob = require('glob');
const uuid = require('node-uuid');
const fs = BPromise.promisifyAll(require('fs'));
const posterRasterCore = require('./poster-raster-core');
const posterSvgCore = require('./poster-svg-core');
const posterPdfCore = require('./poster-pdf-core');
const config = require('../config');
const {
  getTempPath,
  getFontMapping,
  SHARP_RASTER_IMAGE_TYPES,
} = require('../util/poster');
const logger = require('../util/logger')(__filename);

const globAsync = BPromise.promisify(glob);

async function render(_opts) {
  const opts = _.merge({
    useTileRender: false,
    material: 'paper',
  }, _opts, {
    uuid: uuid.v4(),
  });

  try {
    const poster = await _renderPoster(opts);
    return poster;
  } finally {
    console.log('_deleteFiles start')
    await _deleteFiles(opts);
    console.log('_deleteFiles end')
  }
}

async function _renderPoster(opts) {
  const newOpts = _.extend({}, opts, {
    fontMapping: getFontMapping(),
    // This render function is injected to the options
    // for pdf-png rendering, to eliminate circular dependency
    originalRender: render,
  });

  if (_.includes(SHARP_RASTER_IMAGE_TYPES, newOpts.format)) {
    return await posterRasterCore.render(newOpts);
  } else if (newOpts.format === 'svg') {
    return await posterSvgCore.render(newOpts);
  } else if (newOpts.format === 'pdf') {
    return await posterPdfCore.render(newOpts);
  } else if (newOpts.format === 'pdf-png') {
    return await posterPdfCore.render(_.extend({}, newOpts, { embedPng: true }));
  }

  throw new Error(`Unknown format requested: ${newOpts.format}`);
}

async function _deleteFiles(opts) {
  if (config.SAVE_TEMP_FILES) {
    return;
  }

  const filePattern = `${opts.uuid}*`;
  if (filePattern.length < 10) {
    throw new Error(`Unsafe delete pattern detected: ${filePattern}`);
  }
  const pattern = getTempPath(filePattern);
  const files = await globAsync(pattern);
  logger.info(`Deleting ${files.length} temporary files`);
  for (let i = 0; i < files.length; i += 1) {
    try {
      console.log('unlinkAsync start', files[i]);
      await fs.unlinkAsync(files[i]);
      console.log('unlinkAsync end', files[i]);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error(`Error deleting temp file (${files[i]}): ${err}`);
        throw err;
      } else {
        logger.info(`Temp file was already deleted: ${files[i]}`);
      }
    }
  }
}

module.exports = {
  render,
};
