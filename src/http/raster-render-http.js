const BPromise = require('bluebird');
const _ = require('lodash');
const ex = require('../util/express');
const rasterMapCore = require('../core/raster-map-core');
const posterCore = require('../core/poster-core');
const ROLES = require('../enum/roles');

const getRender = ex.createRoute((req, res) => {
  const opts = {
    style: req.query.style,
    size: req.query.size,
    orientation: req.query.orientation,
    width: Number(req.query.width),
    height: Number(req.query.height),
    view: {
      topLeft: {
        lat: Number(req.query.tlLat),
        lng: Number(req.query.tlLng)
      },
      bottomRight: {
        lat: Number(req.query.brLat),
        lng: Number(req.query.brLng)
      },
    },
    scale: Number(req.query.scale) || 1,
    labelsEnabled: Boolean(req.query.labelsEnabled),
    labelHeader: req.query.labelHeader || '',
    labelSmallHeader: req.query.labelSmallHeader || '',
    labelText: req.query.labelText || '',
  };

  return posterCore.render(opts)
    .then((image) => {
      res.set('content-type', 'image/png');
      res.send(image);
    });
});

module.exports = {
  getRender,
};
