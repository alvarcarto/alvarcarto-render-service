const BPromise = require('bluebird');
const path = require('path');
const _ = require('lodash');
const fs = require('fs');
const ex = require('../util/express');
const posterCore = require('../core/poster-core');
const mapCore = require('../core/raster-map-core');
const placeItCore = require('../core/place-it-core');
const ROLES = require('../enum/roles');

BPromise.promisifyAll(fs);

const getRender = ex.createRoute((req, res) => {
  const resizeDefined = _.has(req.query, 'resizeToWidth') || _.has(req.query, 'resizeToHeight');
  if (!resizeDefined && _.get(req, 'user.role') !== ROLES.ADMIN) {
    ex.throwStatus(403, 'Anonymous requests must define a resize parameter.');
  }

  const opts = _reqToOpts(req);
  return posterCore.render(opts)
    .then((image) => {
      res.set('content-type', 'image/png');
      if (req.query.download) {
        const name = getAttachmentName(opts);
        res.set('content-disposition', `attachment; filename=${name}.png;`);
      }

      res.send(image);
    });
});

const getRenderCustom = ex.createRoute((req, res) => {
  const resizeDefined = _.has(req.query, 'resizeToWidth') || _.has(req.query, 'resizeToHeight');
  if (!resizeDefined && _.get(req, 'user.role') !== ROLES.ADMIN) {
    ex.throwStatus(403, 'Anonymous requests must define a resize parameter.');
  }

  const file = req.query.file;
  const fileBasePath = path.join(__dirname, '../../posters/dist/custom', file);

  return fs.readFileAsync(`${fileBasePath}.json`, { encoding: 'utf8' })
    .then(content => JSON.parse(content))
    .then((settings) => {
      const opts = _.merge({}, _reqToOpts(req), {
        custom: {
          filePath: `${fileBasePath}.svg`,
          middleLineStrokeWidth: settings.middleLineStrokeWidth,
        },
        scale: settings.scale,
      });

      return posterCore.render(opts);
    })
    .then((image) => {
      res.set('content-type', 'image/png');
      if (req.query.download) {
        const name = getAttachmentName(opts);
        res.set('content-disposition', `attachment; filename=${name}.png;`);
      }
      res.send(image);
    });
});

const getRenderMap = ex.createRoute((req, res) => {
  if (_.get(req, 'user.role') !== ROLES.ADMIN) {
    ex.throwStatus(403, 'Anonymous requests must define a resize parameter.');
  }

  const width = Number(req.query.width);
  const height = Number(req.query.height);

  const minSide = Math.min(width, height);
  const mapOpts = {
    width,
    height,
    mapStyle: req.query.mapStyle,
    bounds: {
      southWest: {
        lat: Number(req.query.swLat),
        lng: Number(req.query.swLng),
      },
      northEast: {
        lat: Number(req.query.neLat),
        lng: Number(req.query.neLng),
      },
    },
    scale: Number(req.query.scale) || Math.sqrt(minSide) / 20,
  };

  return mapCore.render(_.omit(mapOpts, _.isNil))
    .then((image) => {
      res.set('content-type', 'image/png');
      if (req.query.download) {
        const name = `alvarcarto-map-${width}x${height}`;
        res.set('content-disposition', `attachment; filename=${name}.png;`);
      }
      res.send(image);
    });
});

const getPlaceIt = ex.createRoute((req, res) => {
  const opts = _.merge({}, _reqToOpts(req), {
    photo: req.query.background,
    frames: req.query.frames,
  });
  return placeItCore.render(opts)
    .then((image) => {
      res.set('content-type', 'image/png');
      if (req.query.download) {
        const name = getAttachmentName(opts);
        res.set('content-disposition', `attachment; filename=${name}.png;`);
      }
      res.send(image);
    });
});

function _reqToOpts(req) {
  const size = req.query.size;
  const opts = {
    mapStyle: req.query.mapStyle,
    posterStyle: req.query.posterStyle,
    primaryColor: req.query.primaryColor,
    size,
    orientation: req.query.orientation,
    resizeToWidth: req.query.resizeToWidth ? Number(req.query.resizeToWidth) : null,
    resizeToHeight: req.query.resizeToHeight ? Number(req.query.resizeToHeight) : null,
    bounds: {
      southWest: {
        lat: Number(req.query.swLat),
        lng: Number(req.query.swLng),
      },
      northEast: {
        lat: Number(req.query.neLat),
        lng: Number(req.query.neLng),
      },
    },
    scale: Number(req.query.scale) || _getDefaultScale(size),
    labelsEnabled: Boolean(req.query.labelsEnabled),
    labelHeader: req.query.labelHeader || '',
    labelSmallHeader: req.query.labelSmallHeader || '',
    labelText: req.query.labelText || '',
  };
  return opts;
}

function _getDefaultScale(size) {
  switch (size) {
    case '14.8x21cm':
      return 2;
    case '30x40cm':
      return 3;
    case '50x70cm':
      return 4;
    case '70x100cm':
      return 5;
  }

  throw new Error(`Unknown size: ${size}`);
}

function getAttachmentName(opts) {
  const part1 = `${opts.labelHeader.toLowerCase()}-${opts.size.toLowerCase()}`
  return `${part1}-${opts.posterStyle.toLowerCase()}-${opts.mapStyle.toLowerCase()}`;
}

module.exports = {
  getRender,
  getRenderCustom,
  getRenderMap,
  getPlaceIt,
};
