const BPromise = require('bluebird');
const _ = require('lodash');
const sharp = require('sharp');
const fs = BPromise.promisifyAll(require('fs'));
const window = require('svgdom');
const mapCore = require('./map-core');
const mapCorePool = require('./map-core-pool');
const rasterTileMapCore = require('./raster-tile-map-core');
const {
  getPosterDimensions,
  transformPosterSvgDoc,
  parseSvgString,
  readPosterFile,
  getTempPath,
} = require('../util/poster');
const config = require('../config');
const logger = require('../util/logger')(__filename);

async function render(originalOpts) {
  window.setFontDir(config.FONT_DIR)
    .setFontFamilyMappings(originalOpts.fontMapping);

  const isSmallWidth = _.isFinite(originalOpts.resizeToWidth) && originalOpts.resizeToWidth < 300;
  const isSmallHeight = _.isFinite(originalOpts.resizeToHeight) && originalOpts.resizeToHeight < 300;
  if (isSmallWidth || isSmallHeight) {
    originalOpts.useTileRender = true;
  }

  // Request a PNG from mapnik and re-encode it to requested format with sharp later.
  // Note that tile-renderer will always return png
  const newOpts = _.extend({}, originalOpts, {
    format: 'png',
  });
  let image;
  if (newOpts.labelsEnabled) {
    image = await _normalRender(newOpts);
  } else {
    image = await _renderWithoutLabels(newOpts);
  }

  if (originalOpts.format !== 'png') {
    image = await convertToFormat(image, originalOpts);
  }

  return image;
}

async function _renderWithoutLabels(opts) {
  const { mapImage, dimensions } = await _renderMapWithTempFileSaving(opts);

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

  const pngBuf = await _renderPoster(posterOpts);
  return pngBuf;
}

async function convertToFormat(pngBuf, opts) {
  logger.info(`Converting png to format ${opts.format}`);
  return await sharp(pngBuf, { limitInputPixels: false })
    .toFormat(opts.format, { quality: opts.quality })
    .toBuffer();
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

  // If no resize parameters are defined, use mapCore to avoid any possible issues with
  // pooling
  if (!opts.resizeToWidth && !opts.resizeToHeight) {
    return {
      mapImage: await mapCore.render(_.omit(mapOpts, _.isNil)),
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
    mapImage: await mapCorePool.render(_.omit(_.merge({}, mapOpts, { scale }), _.isNil)),
    dimensions,
  };
}

async function _renderPoster(opts) {
  const svgString = await readPosterFile(opts);
  const dimensions = await getPosterDimensions(opts);
  // TODO: no dimensions necessarily
  const mapMeta = await sharp(opts.mapImage, { limitInputPixels: false }).metadata();

  const parsed = parseSvgString(svgString);
  const expected = `${dimensions.width}x${dimensions.height}`;
  const actual = `${mapMeta.width}x${mapMeta.height}`;
  if (expected !== actual) {
    throw new Error(`Map image has incorrect dimensions: ${actual}, expected: ${expected}`);
  }

  const newSvgString = transformPosterSvgDoc(parsed.doc, _.extend({}, opts, { serialize: true }));
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
