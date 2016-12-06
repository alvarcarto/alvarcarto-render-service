const BPromise = require('bluebird');
const _ = require('lodash');
const path = require('path');
const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');
const validate = require('express-validation');
const morgan = require('morgan');
const errorhandler = require('errorhandler');
const compression = require('compression');
const render = require('./render').render;
const Joi = require('joi');
const lwip = BPromise.promisifyAll(require('lwip'));
BPromise.promisifyAll(require('lwip/lib/Image').prototype);
BPromise.promisifyAll(require('lwip/lib/Batch').prototype);

process.env.PORT = process.env.PORT || 5000;

const app = express();
app.disable('x-powered-by');

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

app.use(bodyParser.json());
app.use(compression({
  // Compress everything over 10 bytes
  threshold: 10
}));

const renderSchema = {
  query: {
    width: Joi.number().integer().min(128).max(4096).required(),
    height: Joi.number().integer().min(128).max(4096).required(),
    zoom: Joi.number().min(0).max(14).required(),
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
    bearing: Joi.number().min(-360).max(360).optional(),
    pitch: Joi.number().min(0).max(60).optional(),
  }
};
app.get('/api/render', validate(renderSchema), (req, res, next) => {
  const opts = {
    width: req.query.width,
    height: req.query.height,
    zoom: req.query.zoom,
    center: [req.query.lng, req.query.lat],
    bearing: req.query.bearing,
    pitch: req.query.pitch,
    ratio: 2.0,
    style: 'http://tiles.alvarcarto.com:8000/styles/bright-v9.json',
    accessToken: 'pk.eyJ1IjoiYWx2YXJjYXJ0byIsImEiOiJjaXdhb2s5Y24wMDJ6Mm9vNjVvNXdqeDRvIn0.wC2GAwpt9ggrV-mGAD_E0w'
  };

  render(_.omit(opts, _.isNil))
    .then(sharpObj => sharpObj.png().toBuffer())
    .then(image => {
      res.set('content-type', 'image/png')
      res.send(image);
    })
    .catch(next);
});

const placeItSchema = {
  query: {
    zoom: Joi.number().min(0).max(14).required(),
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
    bearing: Joi.number().min(-360).max(360).optional(),
    pitch: Joi.number().min(0).max(60).optional(),
  }
};
app.get('/api/placeit', (req, res, next) => {
  const opts = {
    width: 375,
    height: 525,
    zoom: req.query.zoom,
    center: [req.query.lng, req.query.lat],
    bearing: req.query.bearing,
    pitch: req.query.pitch,
    ratio: 1.0,
    style: './styles/dark/dark.json',
    accessToken: 'pk.eyJ1IjoiYWx2YXJjYXJ0byIsImEiOiJjaXdhb2s5Y24wMDJ6Mm9vNjVvNXdqeDRvIn0.wC2GAwpt9ggrV-mGAD_E0w'
  };

  render(_.omit(opts, _.isNil))
    .then(sharpObj => sharpObj.png().toBuffer())
    .then(mapBuffer => BPromise.props({
      poster: lwip.openAsync('./poster.png'),
      map: lwip.openAsync(mapBuffer, 'png')
        .then(map => map.blurAsync(0))
        .then(map => map.borderAsync(1, {r: 0, g: 0, b: 0, a: 40}))
        .then(map => map.lightenAsync(0))
    }))
    .then(result => {
      const poster = result.poster;
      return poster.pasteAsync(1149, 278, result.map)
    })
    .then(poster => poster.toBufferAsync('png'))
    .then(image => {
      res.set('content-type', 'image/png')
      res.send(image);
    })
    .catch(next);
});

if (process.env.NODE_ENV === 'production') {
  app.use(function errorResponder(err, req, res, next) {
    var status = err.status ? err.status : 500;
    var httpMessage = http.STATUS_CODES[status];
    res.status(status);
    res.send(httpMessage);
  });
} else {
  // This is not production safe error handler
  app.use(errorhandler());
}

// Start server
const server = app.listen(process.env.PORT, function() {
  console.log(
    'Express server listening on http://localhost:%d/ in %s mode',
    process.env.PORT,
    app.get('env')
  );
});

function _closeServer(signal) {
  console.log(signal + ' received');
  console.log('Closing http.Server ..');
  server.close();
  process.exit(1);
}

process.once('SIGTERM', _closeServer.bind(this, 'SIGTERM'));
process.once('SIGINT', _closeServer.bind(this, 'SIGINT(Ctrl-C)'));
