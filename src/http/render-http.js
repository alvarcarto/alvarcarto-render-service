const BPromise = require('bluebird');
const path = require('path');
const _ = require('lodash');
const uuid = require('node-uuid');
const mimeTypes = require('mime-types');
const fs = require('fs');
const ex = require('../util/express');
const posterCore = require('../core/poster-core');
const mapCore = require('../core/raster-map-core');
const tileMapCore = require('../core/raster-tile-map-core');
const config = require('../config');
const ROLES = require('../enum/roles');

BPromise.promisifyAll(fs);

// Set very long timeout. Needed for rendering e.g. roads for the whole world
// Enable only for API authenticated users!
// NOTE: This was still not enough to render world at zoom level 4
//       I suspect this to be the issue: https://github.com/mapnik/mapnik/issues/3644
//       or some other timeout inside mapnik node bindings or mapnik
const SOCKET_TIMEOUT = 10 * 60 * 1000;

const getRender = ex.createRoute((req, res) => {
  // Don't allow anon request to request vector formats
  const customFormat = _.has(req.query, 'format') && _.includes(['png', 'jpg'], req.query.format);
  const resizeDefined = _.has(req.query, 'resizeToWidth') || _.has(req.query, 'resizeToHeight');
  const isAnon = _.get(req, 'user.role') !== ROLES.ADMIN;
  if (isAnon && (!resizeDefined || customFormat)) {
    ex.throwStatus(403, 'Anonymous requests must define a resize parameter.');
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

  return posterCore.render(opts)
    .then((image) => {
      res.set('content-type', getMimeType(opts));
      if (req.query.download) {
        const name = getAttachmentName(opts);
        res.set('content-disposition', `attachment; filename=${name}.${opts.format};`);
      }

      res.send(image);
    });
});

const getRenderCustom = ex.createRoute(async (req, res) => {
  if (_.get(req, 'user.role') !== ROLES.ADMIN) {
    ex.throwStatus(403, 'Anonymous requests not allowed.');
  }

  req.setTimeout(SOCKET_TIMEOUT);
  res.setTimeout(SOCKET_TIMEOUT);

  const file = req.query.file;
  const fileBasePath = path.join(__dirname, '../../posters/dist/custom', file);

  const content = fs.readFileAsync(`${fileBasePath}.json`, { encoding: 'utf8' });
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

const getRenderMap = ex.createRoute((req, res) => {
  if (_.get(req, 'user.role') !== ROLES.ADMIN) {
    ex.throwStatus(403, 'Anonymous requests not allowed.');
  }

  req.setTimeout(SOCKET_TIMEOUT);
  res.setTimeout(SOCKET_TIMEOUT);

  const mapOpts = _reqToRenderMapOpts(req);
  const imagePromise = req.query.useTileRender
    ? tileMapCore.render(_.omit(mapOpts, _.isNil))
    : mapCore.render(_.omit(mapOpts, _.isNil));

  return imagePromise
    .then((image) => {
      res.set('content-type', `image/${mapOpts.format}`);
      if (req.query.download) {
        const name = `alvarcarto-map-${mapOpts.width}x${mapOpts.height}`;
        res.set('content-disposition', `attachment; filename=${name}.${mapOpts.format};`);
      }
      res.send(image);
    });
});

const getRenderBackground = ex.createRoute((req, res) => {
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

  return tileMapCore.render(_.omit(mapOpts, _.isNil))
    .then((image) => {
      const name = `${uuid.v4()}.png`;
      const filePath = path.join(config.BACKGROUNDS_DIR, name);
      return BPromise.props({
        file: fs.writeFileAsync(filePath, image, { encoding: null }),
        name,
      });
    })
    .then(({ name }) => {
      res.json({
        path: `/api/backgrounds/${name}`,
      });
    });
});

function _reqToOpts(req) {
  const size = req.query.size;
  const opts = {
    format: req.query.format || 'png',
    mapStyle: req.query.mapStyle,
    posterStyle: req.query.posterStyle,
    primaryColor: req.query.primaryColor,
    size,
    orientation: req.query.orientation,
    useTileRender: req.query.useTileRender,
    resizeToWidth: req.query.resizeToWidth ? Number(req.query.resizeToWidth) : null,
    resizeToHeight: req.query.resizeToHeight ? Number(req.query.resizeToHeight) : null,
    bounds: _reqToBounds(req),
    scale: Number(req.query.scale) || _getDefaultScale(size),
    labelsEnabled: Boolean(req.query.labelsEnabled),
    labelHeader: req.query.labelHeader || '',
    labelSmallHeader: req.query.labelSmallHeader || '',
    labelText: req.query.labelText || '',
  };
  return opts;
}

function _reqToRenderMapOpts(req) {
  const width = Number(req.query.width);
  const height = Number(req.query.height);

  const minSide = Math.min(width, height);
  const mapOpts = {
    width,
    height,
    mapStyle: req.query.mapStyle,
    bounds: _reqToBounds(req),
    scale: Number(req.query.scale) || Math.sqrt(minSide) / 20,
    format: req.query.format || 'png',
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

function _getDefaultScale(size) {
  switch (size) {
    case 'A6':
      return 1;
    case 'A5':
      return 2;
    case 'A4':
      return 2.5;
    case 'A3':
      return 3;

    // A5
    case '14.8x21cm':
      return 2;

    case '30x40cm':
      return 3;
    case '50x70cm':
      return 4;
    case '70x100cm':
      return 5;

    case '12x18inch':
      return 3;
    case '18x24inch':
      return 4;
    case '24x36inch':
      return 5;
  }

  throw new Error(`Unknown size: ${size}`);
}

function getAttachmentName(opts) {
  const part1 = `${opts.labelHeader.toLowerCase()}-${opts.size.toLowerCase()}`
  return `${part1}-${opts.posterStyle.toLowerCase()}-${opts.mapStyle.toLowerCase()}`;
}

function getMimeType(opts) {
  return mimeTypes.contentType(opts.format);
}

module.exports = {
  getRender,
  getRenderCustom,
  getRenderMap,
  getRenderBackground,
};
