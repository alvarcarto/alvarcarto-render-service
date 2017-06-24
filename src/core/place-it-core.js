const _ = require('lodash');
const BPromise = require('bluebird');
const path = require('path');
const posterCore = require('./poster-core');
const sharp = require('sharp');

function render(_opts) {
  const opts = _.merge({
    photo: 'brick-wall.jpg',
  }, _opts);

  const mapRenderOpts = _.omit(_.merge({}, opts, {
    resizeToWidth: 400,
    resizeToHeight: null,
  }), _.isNil);
  return posterCore.render(mapRenderOpts)
    .then(posterImage => BPromise.props({
      photoImage: sharp(getFilePath(`./images/${opts.photo}`))
        .overlayWith(posterImage)
        .png()
        .toBuffer(),
    }))
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

function getFilePath(relativePath) {
  return path.join(__dirname, '../../', relativePath);
}

module.exports = {
  render,
};
