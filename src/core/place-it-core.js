const _ = require('lodash');
const BPromise = require('bluebird');
const path = require('path');
const lwip = BPromise.promisifyAll(require('lwip'));
BPromise.promisifyAll(require('lwip/lib/Image').prototype);
BPromise.promisifyAll(require('lwip/lib/Batch').prototype);
const sharp = require('sharp');
const posterCore = require('./poster-core');

const photoMetas = {
  'brick-wall': {
    fileName: 'brick-wall.jpg',
    type: 'center',
    resizeToWidth: 800,
  },
  'facebook-carousel': {
    fileName: 'facebook-carousel.png',
    type: 'center',
    resizeToSide: 1300,
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
    bottomRight: { x: 905, y: 776 },
    bottomLeft: { x: 411, y: 777 },
  },
  'black-frame-beige-landscape': {
    fileName: 'black-frame-beige-landscape.jpg',
    type: 'exact',
    size: '70x100cm',
    orientation: 'landscape',
    topLeft: { x: 524, y: 173 },
    topRight: { x: null, y: null },
    bottomRight: { x: 1262, y: 692 },
    bottomLeft: { x: null, y: null },
  },
  'black-frame-plant': {
    fileName: 'black-frame-plant.jpg',
    type: 'exact',
    size: '30x40cm',
    orientation: 'portrait',
    topLeft: { x: 461, y: 139 },
    topRight: { x: null, y: null },
    bottomRight: { x: 1039, y: 905 },
    bottomLeft: { x: null, y: null },
  },
  'black-frame-white': {
    fileName: 'black-frame-white.jpg',
    type: 'exact',
    size: '70x100cm',
    orientation: 'portrait',
    topLeft: { x: 492, y: 279 },
    topRight: { x: null, y: null },
    bottomRight: { x: 898, y: 858 },
    bottomLeft: { x: null, y: null },
  },
  'black-frame-white-fireplace': {
    fileName: 'black-frame-white-fireplace.jpg',
    type: 'exact',
    size: '70x100cm',
    orientation: 'portrait',
    topLeft: { x: 535, y: 81 },
    topRight: { x: null, y: null },
    bottomRight: { x: 782, y: 431 },
    bottomLeft: { x: null, y: null },
  },
  'black-frame-black-wall': {
    fileName: 'black-frame-black-wall.jpg',
    type: 'exact',
    size: '50x70cm',
    orientation: 'portrait',
    topLeft: { x: 352, y: 131 },
    topRight: { x: null, y: null },
    bottomRight: { x: 843, y: 820 },
    bottomLeft: { x: null, y: null },
  },
  'black-frame-gold-laundry-basket': {
    fileName: 'black-frame-gold-laundry-basket.jpg',
    type: 'exact',
    size: '30x40cm',
    orientation: 'portrait',
    topLeft: { x: 358, y: 145 },
    topRight: { x: null, y: null },
    bottomRight: { x: 821, y: 763 },
    bottomLeft: { x: null, y: null },
  },
  'white-frame-children-bedroom': {
    fileName: 'white-frame-children-bedroom.jpg',
    type: 'exact',
    size: '50x70cm',
    orientation: 'portrait',
    topLeft: { x: 429, y: 145 },
    topRight: { x: null, y: null },
    bottomRight: { x: 907, y: 815 },
    bottomLeft: { x: null, y: null },
  },
  'frame-in-hipster-cafe': {
    fileName: 'frame-in-hipster-cafe.jpg',
    type: 'exact',
    size: '50x70cm',
    orientation: 'portrait',
    topLeft: { x: 352, y: 252 },
    topRight: { x: null, y: null },
    bottomRight: { x: 787, y: 862 },
    bottomLeft: { x: null, y: null },
  },
};

function render(_opts) {
  const { resizeToWidth, resizeToHeight } = _opts;
  const opts = _.merge({
    photo: 'facebook-carousel',
  }, _.omit(_opts, ['resizeToWidth', 'resizeToHeight']));

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
    .then((photoImage) => {
      const photo = sharp(photoImage);
      if (_.isFinite(resizeToWidth)) {
        return photo.resize(resizeToWidth, null);
      } else if (_.isFinite(resizeToHeight)) {
        return photo.resize(null, resizeToHeight);
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

  return _renderPoster(mapRenderOpts)
    .then(poster =>
      lwip.openAsync(poster, 'png')
        .then(p => p.fadeAsync(0.03))
        .then(p => p.darkenAsync(0.05))
        .then(p => p.toBufferAsync('png')),
    )
    .then(posterImage =>
      sharp(getFilePath(`./images/${photoMeta.fileName}`))
        .overlayWith(posterImage, {
          top: photoMeta.topLeft.y,
          left: photoMeta.topLeft.x,
          gravity: sharp.gravity.northwest,
        })
        .png()
        .toBuffer(),
    );
}

function _renderCenter(photoMeta, opts) {
  const newOpts = {};
  if (photoMeta.resizeToSide) {
    if (opts.orientation === 'portrait') {
      newOpts.resizeToHeight = photoMeta.resizeToSide;
    } else {
      newOpts.resizeToWidth = photoMeta.resizeToSide;
    }
  }

  const mapRenderOpts = _.omit(_.merge({}, opts, newOpts, {
    resizeToWidth: photoMeta.resizeToWidth,
    resizeToHeight: photoMeta.resizeToHeight,
  }), _.isNil);

  return _renderPoster(mapRenderOpts)
    .then(posterImage =>
      sharp(getFilePath(`./images/${photoMeta.fileName}`))
        .overlayWith(posterImage)
        .png()
        .toBuffer(),
    );
}

function _renderPoster(opts) {
  return posterCore.render(opts)
    .then((posterImage) => {
      if (opts.frames === 'black') {
        const borderSize = 16;
        return sharp(posterImage)
          .background({ r: 20, g: 20, b: 20 })
          .extend({ top: borderSize, bottom: borderSize, left: borderSize, right: borderSize })
          .png()
          .toBuffer();
      }

      return posterImage;
    });
}

function getFilePath(relativePath) {
  return path.join(__dirname, '../../', relativePath);
}

module.exports = {
  render,
};
