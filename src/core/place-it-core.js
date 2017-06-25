const _ = require('lodash');
const BPromise = require('bluebird');
const path = require('path');
const posterCore = require('./poster-core');
const sharp = require('sharp');

const photoMetas = {
  'brick-wall': {
    fileName: 'brick-wall.jpg',
    type: 'center',
    resizeToWidth: 800,
  },
  'white-frame-gold': {
    fileName: 'white-frame-gold.jpg',
    type: 'exact',
    size: '70x100cm',
    orientation: 'portrait',
    topLeft: { x: 454, y: 180 },
    topRight: { x: 996, y: 180 },
    bottomRight: { x: 998, y: 956 },
    bottomLeft: { x: 998, y: 956 },
  },
  'black-frame-pink': {
    fileName: 'black-frame-pink.jpg',
    type: 'exact',
    size: '50x70cm',
    orientation: 'portrait',
    topLeft: { x: 410, y: 85 },
    topRight: { x: 907, y: 85 },
    bottomRight: { x: 907, y: 776 },
    bottomLeft: { x: 411, y: 777 },
  },
};

function render(_opts) {
  const opts = _.merge({
    photo: 'brick-wall',
  }, _opts);

  const photoMeta = photoMetas[opts.photo];
  if (!photoMeta) {
    const err = new Error(`Photo not found: ${opts.photoMeta}`);
    err.status = 404;
    throw err;
  }

  let renderPromise;
  if (photoMeta.type === 'center') {
    renderPromise = _renderCenter(photoMeta, opts);
  } else if (photoMeta.type === 'exact') {
    renderPromise = _renderExact(photoMeta, opts);
  } else {
    throw new Error(`Unexpected photo type: ${photoMeta.type}`);
  }

  return renderPromise
    .then(({ photoImage }) => {
      const photo = sharp(photoImage);
      if (_.isFinite(opts.resizeToWidth)) {
        return photo.resize(opts.resizeToWidth, null);
      } else if (_.isFinite(opts.resizeToHeight)) {
        return photo.resize(null, opts.resizeToHeight);
      }

      return photo;
    })
    .then(photo => photo.png().toBuffer());
}

function _renderExact(photoMeta, opts) {
  const width = photoMeta.bottomRight.x - photoMeta.topLeft.x;
  const mapRenderOpts = _.omit(_.merge({}, opts, {
    size: photoMeta.size,
    orientation: photoMeta.orientation,
    resizeToWidth: width,
    resizeToHeight: null,
  }), _.isNil);

  return posterCore.render(mapRenderOpts)
    .then(posterImage => BPromise.props({
      photoImage: sharp(getFilePath(`./images/${photoMeta.fileName}`))
        .overlayWith(posterImage, {
          top: photoMeta.topLeft.y,
          left: photoMeta.topLeft.x,
          gravity: sharp.gravity.northwest,
        })
        .png()
        .toBuffer(),
    }));
}

function _renderCenter(photoMeta, opts) {
  const mapRenderOpts = _.omit(_.merge({}, opts, {
    resizeToWidth: photoMeta.resizeToWidth,
    resizeToHeight: null,
  }), _.isNil);

  return posterCore.render(mapRenderOpts)
    .then(posterImage => BPromise.props({
      photoImage: sharp(getFilePath(`./images/${photoMeta.fileName}`))
        .overlayWith(posterImage)
        .png()
        .toBuffer(),
    }));
}

function getFilePath(relativePath) {
  return path.join(__dirname, '../../', relativePath);
}

module.exports = {
  render,
};
