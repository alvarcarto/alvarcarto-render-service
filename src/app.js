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
const logger = require('./util/logger')(__filename);

function createApp() {
  logger.info(`Using style directory: ${config.STYLE_DIR}`);
  logger.info(`Using font directory: ${config.FONT_DIR}`);
  logger.info(`Using backgrounds directory: ${config.BACKGROUNDS_DIR}`);

  const app = express();
  app.disable('x-powered-by');
  // App is served behind CloudFlare and Caddy proxy hops.
  // This is needed to be able to use req.ip or req.secure
  app.enable('trust proxy', 2);

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
  logger.info(`Using CORS options: ${JSON.stringify(corsOpts)}`);
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
