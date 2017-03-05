const ex = require('../util/express');
const posterCore = require('../core/poster-core');
const sharp = require('sharp');
const ROLES = require('../enum/roles');

const getRender = ex.createRoute((req, res) => {
  const opts = {
    style: req.query.style,
    size: req.query.size,
    orientation: req.query.orientation,
    resizeToWidth: Number(req.query.resizeToWidth),
    resizeToHeight: Number(req.query.resizeToHeight),
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
      if (opts.resizeToWidth) {
        return sharp(image).resize(opts.resizeToWidth, null).png().toBuffer();
      } else if (opts.resizeToHeight) {
        return sharp(image).resize(null, opts.resizeToHeight).png().toBuffer();
      }

      return image;
    })
    .then((image) => {
      res.set('content-type', 'image/png');
      res.send(image);
    });
});

module.exports = {
  getRender,
};
