const ex = require('../util/express');
const posterCore = require('../core/poster-core');
const ROLES = require('../enum/roles');

const getRender = ex.createRoute((req, res) => {
  const opts = {
    style: req.query.style,
    size: req.query.size,
    orientation: req.query.orientation,
    width: Number(req.query.width),
    height: Number(req.query.height),
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
    scale: Number(req.query.scale) || 1,
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

module.exports = {
  getRender,
};
