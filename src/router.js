const Joi = require('joi');
const validate = require('express-validation');
const express = require('express');
const render = require('./http/render-http');

function createRouter() {
  const router = express.Router();
  const renderSchema = {
    query: {
      width: Joi.number().integer().min(128).max(4096).required(),
      height: Joi.number().integer().min(128).max(4096).required(),
      zoom: Joi.number().min(0).max(14).required(),
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
      bearing: Joi.number().min(-360).max(360).optional(),
      pitch: Joi.number().min(0).max(60).optional(),
      style: Joi.string().optional(),
    },
  };
  router.get('/api/render', validate(renderSchema), render.getRender);

  const placeItSchema = {
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
  router.get('/api/placeit', validate(placeItSchema), render.getPlaceIt);
  return router;
}

module.exports = createRouter;
