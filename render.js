const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const mbgl = require('mapbox-gl-native');
const sharp = require('sharp');
const request = require('request');
const mbutil = require('./mapbox-util');

const ACCESS_TOKEN = 'pk.eyJ1IjoiYWx2YXJjYXJ0byIsImEiOiJjaXdhb2s5Y24wMDJ6Mm9vNjVvNXdqeDRvIn0.wC2GAwpt9ggrV-mGAD_E0w';
// const ACCESS_TOKEN = 'tk.eyJ1IjoiYWx2YXJjYXJ0byIsImV4cCI6MTQ4MDk3ODQ0MiwiaWF0IjoxNDgwOTc0ODQyLCJzY29wZXMiOlsiZXNzZW50aWFscyIsInNjb3BlczpsaXN0IiwibWFwOnJlYWQiLCJtYXA6d3JpdGUiLCJ1c2VyOnJlYWQiLCJ1c2VyOndyaXRlIiwidXBsb2FkczpyZWFkIiwidXBsb2FkczpsaXN0IiwidXBsb2Fkczp3cml0ZSIsInN0eWxlczp0aWxlcyIsInN0eWxlczpyZWFkIiwiZm9udHM6cmVhZCIsInN0eWxlczp3cml0ZSIsInN0eWxlczpsaXN0IiwidG9rZW5zOnJlYWQiLCJ0b2tlbnM6d3JpdGUiLCJkYXRhc2V0czpsaXN0IiwiZGF0YXNldHM6cmVhZCIsImRhdGFzZXRzOndyaXRlIiwic3R5bGVzOmRyYWZ0IiwiZm9udHM6bGlzdCIsImZvbnRzOndyaXRlIiwiZm9udHM6bWV0YWRhdGEiLCJkYXRhc2V0czpzdHVkaW8iLCJjdXN0b21lcnM6d3JpdGUiLCJhbmFseXRpY3M6cmVhZCJdLCJjbGllbnQiOiJtYXBib3guY29tIiwibGwiOjE0ODA4NTc5MDYyMjEsIml1IjpudWxsfQ.76ScgdbvXowfFjIjzUXLdQ';

const ratio = 4.0;
const width = 1000;
const height = 1000;

const options = {
  request: function(req, callback) {
    console.log(req)

    var requestUrl;
    try {
      requestUrl = resolveUrl(req);
    } catch (e) {
      return callback(e);
    }

    console.log('url:', requestUrl)
    request({
      url: requestUrl,
      encoding: null,
      gzip: true
    }, (err, res, body) => {
      if (err) {
        console.error('Error requesting: ' + requestUrl);
        return callback(err);
      } else if (res.statusCode !== 200) {
        if (res.statusCode === 404) {
          return callback();
        }

        console.error('Error requesting: ' + requestUrl);
        return callback(new Error(JSON.parse(body).message));
      }

      const response = {};
      if (res.headers.modified) {
        response.modified = new Date(res.headers.modified);
      }
      if (res.headers.expires) {
        response.expires = new Date(res.headers.expires);
      }
      if (res.headers.etag) {
        response.etag = res.headers.etag;
      }
      response.data = body;

      callback(null, response);
    });
  },
  ratio: ratio
};

const map = new mbgl.Map(options);

map.load(require('./styles/antique.json'));

map.render({
  zoom: 3.6,
  pitch: 60,
  bearing: -54.43,
  width: width,
  height: height,
  center: [-75.468, 14.937]
}, function(err, buffer) {
  if (err) {
    throw err;
  }

  map.release();

  const image = sharp(buffer, {
    raw: {
      width: Math.floor(width * ratio),
      height: Math.floor(height * ratio),
      channels: 4
    }
  });

  // Convert raw image buffer to PNG
  image.toFile('image.png', function(err) {
    if (err) {
      throw err;
    }
  });
});

function resolveUrl(req) {
  switch (req.kind) {
    case mbgl.Resource.Style:
      return mbutil.normalizeStyleURL(req.url, ACCESS_TOKEN);
    case mbgl.Resource.Source:
      return mbutil.normalizeSourceURL(req.url, ACCESS_TOKEN);;
    case mbgl.Resource.Tile:
      // console.warn(`Unexpected Tile request: ${req}`);
      // https://a.tiles.mapbox.com/v4/mapbox.mapbox-streets-v6/2/1/1.vector.pbf?access_token=
      return mbutil.normalizeVectorTileURL(req.url, ACCESS_TOKEN);
    case mbgl.Resource.Glyphs:
      return mbutil.normalizeGlyphsURL(req.url, ACCESS_TOKEN);
    case mbgl.Resource.SpriteImage:
      return mbutil.normalizeSpriteURL(stripSpriteUrl(req.url), '@2x', '.png', ACCESS_TOKEN);
    case mbgl.Resource.SpriteJSON:
      return mbutil.normalizeSpriteURL(stripSpriteUrl(req.url), '@2x', '.json', ACCESS_TOKEN);
  }

  throw new Error(`Unknown req.kind: ${req}`);
}

// mapbox://sprites/alvarcarto/ciwaq5i56005g2qnuurw0zr62@2x.json
// mapbox://sprites/alvarcarto/ciwaq5i56005g2qnuurw0zr62@2x.png
function stripSpriteUrl(url) {
  // These formats are passed as separate parameters for normalizeSpriteUrl
  // we need to just strip them off
  return url
    .replace(/@2x\.json/g, '')
    .replace(/@2x\.png/g, '')
    .replace(/\.png/g, '')
    .replace(/\.json/g, '');
}

