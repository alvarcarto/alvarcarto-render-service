const BPromise = require('bluebird');
const path = require('path');
const _ = require('lodash');
const uuid = require('node-uuid');
const mimeTypes = require('mime-types');
const fs = require('fs');
const ex = require('../util/express');
const posterCore = require('../core/poster-core');
const mapCore = require('../core/map-core');
const tileMapCore = require('../core/raster-tile-map-core');
const config = require('../config');
const ROLES = require('../enum/roles');
const {
  SHARP_RASTER_IMAGE_TYPES,
  dimensionsToDefaultScale,
  parseSizeToPixelDimensions,
  svgDocToString,
  ensureFontFamiliesNotInQuotes,
  parseSvgString,
} = require('../util/poster');

BPromise.promisifyAll(fs);

// Set very long timeout. Needed for rendering e.g. roads for the whole world
// Enable only for API authenticated users!
// NOTE: This was still not enough to render world at zoom level 4
//       I suspect this to be the issue: https://github.com/mapnik/mapnik/issues/3644
//       or some other timeout inside mapnik node bindings or mapnik
const SOCKET_TIMEOUT = 10 * 60 * 1000;

const getRender = ex.createRoute(async (req, res) => {
  // Don't allow anon request to request vector formats
  const format = req.query.format || 'png';
  const isAllowedFormat = _.includes(SHARP_RASTER_IMAGE_TYPES, format);
  const resizeDefined = _.has(req.query, 'resizeToWidth') || _.has(req.query, 'resizeToHeight');
  const isAnon = _.get(req, 'user.role') !== ROLES.ADMIN;
  if (isAnon && (!resizeDefined || !isAllowedFormat)) {
    ex.throwStatus(403, 'Anonymous requests must define a resize parameter.');
  }

  if (_.has(req.query, 'spotColor') && req.query.format !== 'pdf') {
    ex.throwStatus(400, 'Option spotColor is only allowed when format is pdf');
  }

  const opts = _reqToOpts(req);

  if (isAnon) {
    if (opts.resizeToWidth && opts.resizeToWidth > 800) {
      ex.throwStatus(403, 'resizeToWidth must be <= 800');
    }

    if (opts.resizeToHeight && opts.resizeToHeight > 800) {
      ex.throwStatus(403, 'resizeToHeight must be <= 800');
    }
  } else {
    req.setTimeout(SOCKET_TIMEOUT);
    res.setTimeout(SOCKET_TIMEOUT);
  }

  const image = await posterCore.render(opts);
  res.set('content-type', getMimeType(opts));
  if (req.query.download) {
    const name = getAttachmentName(opts);
    res.set('content-disposition', `attachment; filename=${name}.${opts.format};`);
  }

  res.send(image);
});

const getRenderCustom = ex.createRoute(async (req, res) => {
  if (_.get(req, 'user.role') !== ROLES.ADMIN) {
    ex.throwStatus(403, 'Anonymous requests not allowed.');
  }

  req.setTimeout(SOCKET_TIMEOUT);
  res.setTimeout(SOCKET_TIMEOUT);

  const file = req.query.file;
  const fileBasePath = path.join(__dirname, '../../posters/dist/custom', file);

  const content = await fs.readFileAsync(`${fileBasePath}.json`, { encoding: 'utf8' });
  const settings = JSON.parse(content);
  const opts = _.merge({}, _reqToOpts(req), {
    custom: {
      filePath: `${fileBasePath}.svg`,
      middleLineStrokeWidth: settings.middleLineStrokeWidth,
    },
    scale: settings.scale,
  });

  const image = await posterCore.render(opts);
  res.set('content-type', getMimeType(opts));
  if (req.query.download) {
    const name = 'alvarcarto-custom';
    res.set('content-disposition', `attachment; filename=${name}.${opts.format};`);
  }
  res.send(image);
});

const getRenderMap = ex.createRoute(async (req, res) => {
  if (_.get(req, 'user.role') !== ROLES.ADMIN) {
    ex.throwStatus(403, 'Anonymous requests not allowed.');
  }

  req.setTimeout(SOCKET_TIMEOUT);
  res.setTimeout(SOCKET_TIMEOUT);

  const mapOpts = _reqToRenderMapOpts(req);
  const imagePromise = req.query.useTileRender
    ? tileMapCore.render(_.omit(mapOpts, _.isNil))
    : mapCore.render(_.omit(mapOpts, _.isNil));

  const image = await imagePromise;
  res.set('content-type', getMimeType(mapOpts));
  if (req.query.download) {
    const name = `alvarcarto-map-${mapOpts.width}x${mapOpts.height}`;
    res.set('content-disposition', `attachment; filename=${name}.${mapOpts.format};`);
  }
  res.send(image);
});

const getPosterFile = ex.createRoute(async (req, res) => {
  if (!_.endsWith(req.params.fileName, 'svg')) {
    ex.throwStatus(400, 'Requested poster must be an svg');
  }

  const absPath = path.join(__dirname, '../../posters/dist/', req.params.fileName);
  const fileContent = await fs.readFileAsync(absPath, { encoding: 'utf-8' });
  const parsed = parseSvgString(fileContent);
  ensureFontFamiliesNotInQuotes(parsed.doc, parsed.svg);
  const newSvg = svgDocToString(parsed.doc);
  res.set('content-type', mimeTypes.contentType('svg'));
  res.send(newSvg);
});

const getRenderBackground = ex.createRoute(async (req, res) => {
  if (!_.startsWith(_.get(req, 'query.mapStyle', ''), 'bg-')) {
    ex.throwStatus(403, 'Only background styles are allowed.');
  }

  const mapOpts = _reqToRenderMapOpts(req);

  if (mapOpts.format !== 'png') {
    ex.throwStatus(403, 'Only png format is allowed.');
  }

  const isTooLarge = mapOpts.width > 3000 || mapOpts.height > 3000 || mapOpts.width * mapOpts.height > 4320000;
  if (_.get(req, 'user.role') !== ROLES.ADMIN && isTooLarge) {
    ex.throwStatus(403, 'Anonymous requests must define a resize parameter.');
  }

  req.setTimeout(SOCKET_TIMEOUT);
  res.setTimeout(SOCKET_TIMEOUT);

  const image = await tileMapCore.render(_.omit(mapOpts, _.isNil));
  const name = `${uuid.v4()}.png`;
  const filePath = path.join(config.BACKGROUNDS_DIR, name);
  await fs.writeFileAsync(filePath, image, { encoding: null });
  res.json({
    path: `/api/backgrounds/${name}`,
  });
});

function parseSpotColor(color) {
  const cmykRegex = /^cmyk\((.*)\)$/;
  if (color.match(cmykRegex)) {
    const inside = cmykRegex.exec(color)[1];
    const numbers = _.map(inside.split(','), i => parseFloat(i));
    if (numbers.length !== 4) {
      ex.throwStatus(400, 'CMYK color must have exactly 4 numbers');
    }
    return {
      type: 'cmyk',
      value: numbers,
    };
  }

  const rgbRegex = /^rgb\((.*)\)$/;
  if (color.match(rgbRegex)) {
    const inside = rgbRegex.exec(color)[1];
    const numbers = _.map(inside.split(','), i => parseFloat(i));
    if (numbers.length !== 3) {
      ex.throwStatus(400, 'RGB color must have exactly 3 numbers');
    }
    return {
      type: 'rgb',
      value: numbers,
    };
  }

  ex.throwStatus(400, 'Option spotColor incorrect format! Must be in format rgb(0, 0, 0) or cmyk(0, 0, 0, 0).');
}

function _reqToOpts(req) {
  const size = req.query.size;
  const dims = parseSizeToPixelDimensions(size, req.query.orientation);
  const spotColor = req.query.spotColor ? parseSpotColor(req.query.spotColor) : null;
  const opts = {
    format: req.query.format || 'png',
    mapStyle: req.query.mapStyle,
    posterStyle: req.query.posterStyle,
    primaryColor: req.query.primaryColor,
    size,
    spotColor,
    spotColorName: spotColor !== null ? req.query.spotColorName : null,
    // When spot color is defined, we use the "fully from svg" generation method
    // for PDF, as it allows spot color to be changed for the map layer as well
    // If you want to e.g. gold foil just the overlay contents, but leave map layer as
    // a normal print, set this explicitly to false while using spot color in the request
    // For example: &spotColor=cmyk(0,100,0,0)&spotColorName=copperfoil&pdfFromSvg=false
    pdfFromSvg: _.isBoolean(req.query.pdfFromSvg)
      ? req.query.pdfFromSvg
      : spotColor !== null,
    orientation: req.query.orientation,
    useTileRender: req.query.useTileRender,
    resizeToWidth: req.query.resizeToWidth ? Number(req.query.resizeToWidth) : null,
    resizeToHeight: req.query.resizeToHeight ? Number(req.query.resizeToHeight) : null,
    bounds: _reqToBounds(req),
    // The order of width, height doesn't matter in dimensionsToDefaultScale function
    scale: Number(req.query.scale) || dimensionsToDefaultScale(dims.width, dims.height),
    labelsEnabled: Boolean(req.query.labelsEnabled),
    labelHeader: req.query.labelHeader || '',
    labelSmallHeader: req.query.labelSmallHeader || '',
    labelText: req.query.labelText || '',
    quality: Number(req.query.quality) || 100,
  };
  return opts;
}

function _reqToRenderMapOpts(req) {
  const width = Number(req.query.width);
  const height = Number(req.query.height);
  const mapOpts = {
    width,
    height,
    mapStyle: req.query.mapStyle,
    bounds: _reqToBounds(req),
    scale: Number(req.query.scale) || dimensionsToDefaultScale(width, height),
    format: req.query.format || 'png',
    quality: Number(req.query.quality) || 100,
  };

  return mapOpts;
}

function _reqToBounds(req) {
  return {
    southWest: {
      lat: Number(req.query.swLat),
      lng: Number(req.query.swLng),
    },
    northEast: {
      lat: Number(req.query.neLat),
      lng: Number(req.query.neLng),
    },
  };
}

function getAttachmentName(opts) {
  const part1 = `${opts.labelHeader.toLowerCase()}-${opts.size.toLowerCase()}`;
  return `${part1}-${opts.posterStyle.toLowerCase()}-${opts.mapStyle.toLowerCase()}`;
}

function getMimeType(opts) {
  let format = opts.format;
  if (format === 'pdf-png') {
    format = 'pdf';
  }
  return mimeTypes.contentType(format);
}

module.exports = {
  getRender,
  getRenderCustom,
  getRenderMap,
  getRenderBackground,
  getPosterFile,
};
