const path = require('path');
const Joi = require('joi');
const _ = require('lodash');
const validate = require('express-validation');
const RateLimit = require('express-rate-limit');
const express = require('express');
const rasterRender = require('./http/raster-render-http');
const config = require('./config');
const ROLES = require('./enum/roles');

const validTokens = config.API_KEY.split(',');

function createRouter() {
  const router = express.Router();

  // Simple token authentication
  router.use('/*', (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (_.includes(validTokens, apiKey)) {
      req.user = {
        role: ROLES.ADMIN,
      };
    } else {
      req.user = {
        role: ROLES.ANONYMOUS,
      };
    }

    return next();
  });

  // Uses req.ip as the default identifier
  // Note that this uses in-memory limiter! In cluster mode the allowed requests are roughly
  // instances * max
  const apiLimiter = new RateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
  });

  const rasterRenderSchema = {
    query: {
      format: Joi.string().valid(['png', 'jpg', 'pdf', 'svg']).optional(),
      size: Joi.string().valid([
        '30x40cm', '50x70cm', '70x100cm',
        '12x18inch', '18x24inch', '24x36inch',
        'A6', 'A5', 'A4', 'A3',
        '14.8x21cm',
      ]).required(),
      resizeToWidth: Joi.number().min(50).optional(),
      resizeToHeight: Joi.number().min(50).optional(),
      posterStyle: Joi.string().valid([
        'sharp', 'classic', 'sans', 'bw',
        'pacific', 'summer', 'round',
      ]).required(),
      mapStyle: Joi.string()
        .regex(/^[a-zA-Z0-9-_]+$/)
        .min(1)
        .max(40)
        .required(),
      orientation: Joi.string().valid(['landscape', 'portrait']).required(),
      swLat: Joi.number().min(-90).max(90).required(),
      swLng: Joi.number().min(-180).max(180).required(),
      neLat: Joi.number().min(-90).max(90).required(),
      neLng: Joi.number().min(-180).max(180).required(),
      scale: Joi.number().min(0).max(1000).optional(),
      labelsEnabled: Joi.boolean().required(),
      labelHeader: Joi.string().optional(),
      labelSmallHeader: Joi.string().optional(),
      labelText: Joi.string().optional(),
      download: Joi.boolean().optional(),
      useTileRender: Joi.boolean().optional(),
    },
  };
  router.get('/api/raster/render', validate(rasterRenderSchema), rasterRender.getRender);

  const placeItSchema = _.merge({}, rasterRenderSchema, {
    query: {
      format: Joi.string().valid(['png', 'jpg']).optional(),
      background: Joi.string().min(1).max(100).optional(),
      frames: Joi.string().min(1).max(100).optional(),
      resizeToWidth: Joi.number().min(50).max(1200).optional(),
      resizeToHeight: Joi.number().min(50).max(1200).optional(),
      download: Joi.boolean().optional(),
      useTileRender: Joi.boolean().optional(),
    },
  });
  router.get('/api/raster/placeit', validate(placeItSchema), rasterRender.getPlaceIt);

  const renderCustomSchema = _.merge({}, rasterRenderSchema, {
    query: {
      file: Joi.string().min(1).max(100).optional(),
      size: Joi.string().optional(),
      download: Joi.boolean().optional(),
      useTileRender: Joi.boolean().optional(),
    },
  });
  router.get('/api/raster/render-custom', validate(renderCustomSchema), rasterRender.getRenderCustom);

  const renderMapSchema = {
    query: {
      format: Joi.string().valid(['png', 'jpg', 'pdf', 'svg']).optional(),
      width: Joi.number().integer().min(1).max(14000)
        .required(),
      height: Joi.number().integer().min(1).max(14000)
        .required(),
      swLat: Joi.number().min(-90).max(90).required(),
      swLng: Joi.number().min(-180).max(180).required(),
      neLat: Joi.number().min(-90).max(90).required(),
      neLng: Joi.number().min(-180).max(180).required(),
      scale: Joi.number().min(0).max(1000).optional(),
      download: Joi.boolean().optional(),
      useTileRender: Joi.boolean().optional(),
    },
  };
  router.get('/api/raster/render-map', validate(renderMapSchema), rasterRender.getRenderMap);
  router.get('/api/raster/render-background', apiLimiter, validate(renderMapSchema), rasterRender.getRenderBackground);

  const getBackgroundSchema = {
    params: {
      fileName: Joi.string()
        .regex(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\.[A-Z]{3}$/i)
        .required(),
    },
  };

  router.get('/api/backgrounds/:fileName', apiLimiter, validate(getBackgroundSchema), (req, res) => {
    const absPath = path.join(config.BACKGROUNDS_DIR, req.params.fileName);
    res.download(absPath);
  });
  return router;
}

module.exports = createRouter;
