const Joi = require('joi');
const _ = require('lodash');
const validate = require('express-validation');
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

  const rasterRenderSchema = {
    query: {
      size: Joi.string().valid(['30x40cm', '50x70cm', '70x100cm']).required(),
      resizeToWidth: Joi.number().min(50).max(400).optional(),
      resizeToHeight: Joi.number().min(50).max(400).optional(),
      posterStyle: Joi.string().valid([
        'sharp', 'classic', 'sans', 'bw',
        'pacific', 'summer', 'round',
      ]).required(),
      mapStyle: Joi.string().valid([
        'bw', 'gray', 'black', 'petrol',
        'iceberg', 'marshmellow', 'copper',
        'madang',
      ]).required(),
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
    },
  };
  router.get('/api/raster/render', validate(rasterRenderSchema), rasterRender.getRender);

  const placeItSchema = _.merge({}, rasterRenderSchema, {
    query: {
      background: Joi.string().min(1).max(100).optional(),
      resizeToWidth: Joi.number().min(50).max(1000).optional(),
      resizeToHeight: Joi.number().min(50).max(1000).optional(),
    },
  });
  router.get('/api/raster/placeit', validate(placeItSchema), rasterRender.getPlaceIt);

  return router;
}

module.exports = createRouter;
