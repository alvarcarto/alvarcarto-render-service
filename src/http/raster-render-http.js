const ex = require('../util/express');
const posterCore = require('../core/poster-core');
const sharp = require('sharp');
const ROLES = require('../enum/roles');

const getRender = ex.createRoute((req, res) => {
  // TODO: check if role is not admin, and throw unauthorized

  const size = req.query.size;
  const opts = {
    style: req.query.style,
    size: size,
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
    scale: Number(req.query.scale) || _getDefaultScale(size),
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
