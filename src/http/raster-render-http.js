const _ = require('lodash');
const ex = require('../util/express');
const posterCore = require('../core/poster-core');
const sharp = require('sharp');
const ROLES = require('../enum/roles');

const getRender = ex.createRoute((req, res) => {
  const resizeDefined = _.has(req.query, 'resizeToWidth') || _.has(req.query, 'resizeToHeight');
  if (!resizeDefined && _.get(req, 'user.role') !== ROLES.ADMIN) {
    ex.throwStatus(403, 'Anonymous requests must define a resize parameter.');
  }

  const size = req.query.size;
  const opts = {
    mapStyle: req.query.mapStyle,
    posterStyle: req.query.posterStyle,
    primaryColor: req.query.primaryColor,
    size: size,
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

  return posterCore.render(opts)
    .then((image) => {
      res.set('content-type', 'image/png');
      res.send(image);
    });
});

function _getDefaultScale(size) {
  switch (size) {
    case '30x40cm':
      return 3;
    case '50x70cm':
      return 4;
    case '70x100cm':
      return 5;
  }

  throw new Error(`Unknown size: ${size}`);
}

module.exports = {
  getRender,
};
