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
const { getTempPath } = require('../util/poster');

async function render(_opts) {
  const opts = _.merge({
    useTileRender: false,
    material: 'paper',
  }, _opts, {
    uuid: uuid.v4(),
  });

  try {
    return await _renderAndDeleteTempFiles(opts);
  } finally {
    await _deleteFiles(opts);
  }
}

async function _renderAndDeleteTempFiles(opts) {
  const files = glob.sync(`${config.FONT_DIR}/*.ttf`);
  const fontMapping = _.reduce(files, (memo, filePath) => {
    const fontName = path.basename(filePath, '.ttf');
    const fileName = path.basename(filePath);
    const newFonts = { [fontName]: fileName };
    if (_.endsWith(fontName, '-Regular')) {
      const baseName = fontName.split('-Regular')[0];
      newFonts[baseName] = fileName;
    }
    return _.extend({}, memo, newFonts);
  }, {});

  const newOpts = _.extend({}, opts, { fontMapping });

  // TODO: Solve how to delete temp files, maybe just glob with the opts.uuid prefix?
  // TODO: Add a proper temp files folder
  if (newOpts.format === 'png' || newOpts.format === 'jpg') {
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

  const tmpSvgPath = getTempPath(`${opts.uuid}.svg`);
  try {
    await fs.unlinkAsync(tmpSvgPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

module.exports = {
  render,
};
