const BPromise = require('bluebird');
const _ = require('lodash');
const sharp = require('sharp');
const uuid = require('node-uuid');
const fs = BPromise.promisifyAll(require('fs'));
const window = require('svgdom');
const rasterMapCore = require('./map-core');
const rasterMapCorePool = require('./map-core-pool');
const rasterTileMapCore = require('./raster-tile-map-core');
const {
  getPosterDimensions,
  transformPosterSvgDoc,
  parsePosterSvg,
  readPosterFile,
  getTempPath,
} = require('../util/poster');
const config = require('../config');


// TODO: Move temp file deletion to poster-core
async function render(opts) {
  window.setFontDir(config.FONT_DIR)
    .setFontFamilyMappings(opts.fontMapping);

  try {
    return await _renderAndDeleteTempFiles(opts);
  } finally {
    await _deleteFiles(opts);
  }
}

async function _renderAndDeleteTempFiles(opts) {
  const isSmallWidth = _.isFinite(opts.resizeToWidth) && opts.resizeToWidth < 300;
  const isSmallHeight = _.isFinite(opts.resizeToHeight) && opts.resizeToHeight < 300;
  if (isSmallWidth || isSmallHeight) {
    opts.useTileRender = true;
  }

  if (opts.labelsEnabled) {
    return await _normalRender(opts);
  }

  return await _renderWithoutLabels(opts);
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

async function _renderWithoutLabels(opts) {
  const { mapImage, dimensions } = await _renderMapWithTempFileSaving(opts);

  // TODO: Return based on format
  const pngBuf = await sharp(mapImage, { limitInputPixels: false })
    .extract({
      left: dimensions.padding,
      top: dimensions.padding,
      width: dimensions.width - (2 * dimensions.padding),
      height: dimensions.height - (2 * dimensions.padding),
    })
    .extend({
      top: dimensions.padding,
      left: dimensions.padding,
      right: dimensions.padding,
      bottom: dimensions.padding,
      background: { r: 255, g: 255, b: 255 },
    })
    .png()
    .toBuffer();

  return pngBuf;
}

async function _normalRender(opts) {
  const { mapImage } = await _renderMapWithTempFileSaving(opts);

  const posterOpts = _.merge({}, opts, {
    mapImage,
  });

  const image = await _renderPoster(posterOpts);
  return image;
}

async function _renderMapWithTempFileSaving(opts) {
  const result = await _renderMap(opts);
  if (config.SAVE_TEMP_FILES) {
    const tmpPngPath = getTempPath(`${opts.uuid}-map.png`);
    await fs.writeFileAsync(tmpPngPath, result.mapImage, { encoding: null });
  }

  return result;
}

async function _renderMap(opts) {
  const dimensions = await getPosterDimensions(opts);

  const mapOpts = _.merge({}, opts, {
    width: dimensions.width,
    height: dimensions.height,
  });

  // If no resize parameters are defined, use rasterMapCore to avoid any possible issues with
  // pooling
  if (!opts.resizeToWidth && !opts.resizeToHeight) {
    return {
      mapImage: await rasterMapCore.render(_.omit(mapOpts, _.isNil)),
      dimensions,
    };
  }

  // Tile renderer must be used for very low zoom levels when rendering e.g. previews
  if (opts.useTileRender) {
    return {
      mapImage: await rasterTileMapCore.render(mapOpts),
      dimensions,
    };
  }

  let scale = opts.scale;
  if (opts.resizeToWidth) {
    scale *= opts.resizeToWidth / dimensions.originalWidth;
  } else if (opts.resizeToHeight) {
    scale *= opts.resizeToHeight / dimensions.originalHeight;
  }

  return {
    mapImage: await rasterMapCorePool.render(_.omit(_.merge({}, mapOpts, { scale }), _.isNil)),
    dimensions,
  };
}

async function _renderPoster(opts) {
  const svgString = await readPosterFile(opts);
  const dimensions = await getPosterDimensions(opts);
  // TODO: no dimensions necessarily
  const mapMeta = await sharp(opts.mapImage, { limitInputPixels: false }).metadata();

  const parsed = parsePosterSvg(svgString);
  const expected = `${dimensions.width}x${dimensions.height}`;
  const actual = `${mapMeta.width}x${mapMeta.height}`;
  if (expected !== actual) {
    throw new Error(`Map image has incorrect dimensions: ${actual}, expected: ${expected}`);
  }

  const newSvgString = transformPosterSvgDoc(parsed.doc, opts);
  const tmpSvgPath = getTempPath(`${opts.uuid}.svg`);

  await fs.writeFileAsync(tmpSvgPath, newSvgString, { encoding: 'utf-8' });
  const svgImage = await sharp(tmpSvgPath, { density: 72, limitInputPixels: false })
      .resize(dimensions.width, dimensions.height)
      .png()
      .toBuffer();

  if (config.SAVE_TEMP_FILES) {
    const tmpPngPath = getTempPath(`${opts.uuid}-svg.png`);
    await fs.writeFileAsync(tmpPngPath, svgImage, { encoding: null });
  }

  const finalImage = await sharp(opts.mapImage, { limitInputPixels: false })
    .composite([{
      input: svgImage,
      top: 0,
      left: 0,
    }])
    .png()
    .toBuffer();

  if (config.SAVE_TEMP_FILES) {
    const tmpPngPath = getTempPath(`${opts.uuid}-combined.png`);
    await fs.writeFileAsync(tmpPngPath, finalImage, { encoding: null });
  }

  return finalImage;
}


module.exports = {
  render,
};
