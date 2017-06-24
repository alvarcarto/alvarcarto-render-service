const Joi = require('joi');
const _ = require('lodash');
const validate = require('express-validation');
const express = require('express');
/*const vectorRender = require('./http/vector-render-http');*/
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

  /*
  const vectorRenderSchema = {
    query: {
      width: Joi.number().integer().min(128).max(4096).required(),
      height: Joi.number().integer().min(128).max(4096).required(),
      zoom: Joi.number().min(0).max(14).required(),
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
      bearing: Joi.number().min(-360).max(360).optional(),
      pitch: Joi.number().min(0).max(60).optional(),
      style: Joi.string().optional(),
      header: Joi.string().optional(),
    },
  };
  router.get('/api/vector/render', validate(vectorRenderSchema), vectorRender.getRender);

  const vectorPlaceItSchema = {
    query: {
      zoom: Joi.number().min(0).max(14).required(),
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
      bearing: Joi.number().min(-360).max(360).optional(),
      pitch: Joi.number().min(0).max(60).optional(),
      style: Joi.string().optional(),
      width: Joi.number().integer().min(128).max(4096).required(),
    },
  };
  router.get('/api/vector/placeit', validate(vectorPlaceItSchema), vectorRender.getPlaceIt);
  */

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
  router.get('/api/raster/placeit', validate(rasterRenderSchema), rasterRender.getPlaceIt);

  return router;
}

module.exports = createRouter;
