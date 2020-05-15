const BPromise = require('bluebird');
const _ = require('lodash');
const glob = require('glob');
const uuid = require('node-uuid');
const path = require('path');
const fs = BPromise.promisifyAll(require('fs'));
const posterRasterCore = require('./poster-raster-core');
const posterSvgCore = require('./poster-svg-core');
const posterPdfCore = require('./poster-pdf-core');
const config = require('../config');
const {
  getTempPath,
  SHARP_RASTER_IMAGE_TYPES,
} = require('../util/poster');

const globAsync = BPromise.promisify(glob);
const FONT_FILES = glob.sync(`${config.FONT_DIR}/*.ttf`);

async function render(_opts) {
  const opts = _.merge({
    useTileRender: false,
    material: 'paper',
  }, _opts, {
    uuid: uuid.v4(),
  });

  try {
    return await _renderPoster(opts);
  } finally {
    await _deleteFiles(opts);
  }
}

async function _renderPoster(opts) {
  const fontMapping = _.reduce(FONT_FILES, (memo, filePath) => {
    const fontName = path.basename(filePath, '.ttf');
    const fileName = path.basename(filePath);
    const newFonts = { [fontName]: fileName };
    if (_.endsWith(fontName, '-Regular')) {
      const baseName = fontName.split('-Regular')[0];
      newFonts[baseName] = fileName;
    }
    return _.extend({}, memo, newFonts);
  }, {});

  const newOpts = _.extend({}, opts, {
    fontMapping,
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

  for (let i = 0; i < files.length; i += 0) {
    try {
      await fs.unlinkAsync(files[i]);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }
}

module.exports = {
  render,
};
