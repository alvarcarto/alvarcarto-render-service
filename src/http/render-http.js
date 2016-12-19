const BPromise = require('bluebird');
const lwip = BPromise.promisifyAll(require('lwip'));
BPromise.promisifyAll(require('lwip/lib/Image').prototype);
BPromise.promisifyAll(require('lwip/lib/Batch').prototype);
const _ = require('lodash');
const ex = require('../util/express');
const vectorMapCore = require('../core/vector-map-core');
const posterCore = require('../core/poster-core');

const getRender = ex.createRoute((req, res) => {
  const opts = {
    width: Number(req.query.width),
    height: Number(req.query.height),
    zoom: Number(req.query.zoom),
    center: [Number(req.query.lng), Number(req.query.lat)],
    bearing: Number(req.query.bearing),
    pitch: Number(req.query.pitch),
    ratio: 8.0,
    style: req.query.style || 'http://tiles.alvarcarto.com:8000/styles/bright-v9.json',
    accessToken: 'pk.eyJ1IjoiYWx2YXJjYXJ0byIsImEiOiJjaXdhb2s5Y24wMDJ6Mm9vNjVvNXdqeDRvIn0.wC2GAwpt9ggrV-mGAD_E0w',
    header: req.query.header,
  };

  return vectorMapCore.render(_.omit(opts, _.isNil))
    .then(sharpObj => sharpObj.png())
    .then(image => posterCore.addLabels(image))
    .then((image) => {
      res.set('content-type', 'image/png');
      res.send(image);
    });
});

const getPlaceIt = ex.createRoute((req, res) => {
  const opts = {
    width: 375,
    height: 525,
    zoom: Number(req.query.zoom),
    center: [Number(req.query.lng), Number(req.query.lat)],
    bearing: Number(req.query.bearing),
    pitch: Number(req.query.pitch),
    ratio: 1.0,
    style: req.query.style || 'http://tiles.alvarcarto.com:8000/styles/bright-v9.json',
    resizeToWidth: Number(req.query.resizeToWidth),
    accessToken: 'pk.eyJ1IjoiYWx2YXJjYXJ0byIsImEiOiJjaXdhb2s5Y24wMDJ6Mm9vNjVvNXdqeDRvIn0.wC2GAwpt9ggrV-mGAD_E0w',
  };

  vectorMapCore.render(_.omit(opts, _.isNil))
    .then(sharpObj => sharpObj.png().toBuffer())
    .then(mapBuffer => BPromise.props({
      poster: lwip.openAsync('./poster.png'),
      map: lwip.openAsync(mapBuffer, 'png')
        .then(map => map.blurAsync(0))
        .then(map => map.lightenAsync(0)),
    }))
    .then((result) => {
      const poster = result.poster;
      return poster.pasteAsync(1149, 278, result.map);
    })
    .then((poster) => {
      if (_.isFinite(opts.resizeToWidth)) {
        const newHeight = opts.resizeToWidth / poster.width() * poster.height();
        return poster.resizeAsync(opts.resizeToWidth, newHeight);
      }

      return poster;
    })
    .then(poster => poster.toBufferAsync('png'))
    .then((image) => {
      res.set('content-type', 'image/png');
      res.send(image);
    });
});

module.exports = {
  getRender,
  getPlaceIt,
};
