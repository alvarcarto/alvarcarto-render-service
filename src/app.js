const path = require('path');
const express = require('express');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const compression = require('compression');
const cors = require('cors');
const errorResponder = require('./middleware/error-responder');
const errorLogger = require('./middleware/error-logger');
const createRouter = require('./router');
const config = require('./config');

function createApp() {
  const app = express();

  // App is served behind CloudFlare proxy.
  // This is needed to be able to use req.ip or req.secure
  app.enable('trust proxy', 1);

  app.disable('x-powered-by');

  if (config.NODE_ENV !== 'production') {
    app.use(morgan('dev'));
  }

  app.use(bodyParser.json({ limit: '1mb' }));
  app.use(compression({
    // Compress everything over 10 bytes
    threshold: 10,
  }));

  const corsOpts = {
    origin: '*',
    methods: ['GET'],
  };
  console.log('Using CORS options:', corsOpts);
  app.use(cors(corsOpts));

  // Initialize routes
  const router = createRouter();

  app.use('/', router);
  app.use('/posters', express.static(path.join(__dirname, '../posters/dist')));


  app.use(errorLogger());
  app.use(errorResponder());

  return app;
}

module.exports = createApp;
