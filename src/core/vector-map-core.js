const _ = require('lodash');
const BPromise = require('bluebird');
const fs = BPromise.promisifyAll(require('fs'));
const mbgl = require('../../../mapbox-gl-native');
const sharp = require('sharp');
const request = require('request');
const mbutil = require('../util/mapbox');

const requestAsync = BPromise.promisify(request);
const RATIO = 4.0;

function main() {
  const accessToken = 'pk.eyJ1IjoiYWx2YXJjYXJ0byIsImEiOiJjaXdhb2s5Y24wMDJ6Mm9vNjVvNXdqeDRvIn0.wC2GAwpt9ggrV-mGAD_E0w';

  render({
    accessToken: accessToken,
    ratio: RATIO,
    width: 4100,
    height: 4100,
    zoom: 12.5,
    pitch: 0,
    bearing: 0,
    center: [24.8968, 60.2976],
    style: './styles/dark/dark.json',
  })
  .then((image) => {
    // Convert raw image buffer to PNG
    image.toFile('image.png', (err) => {
      if (err) {
        throw err;
      }
    });
  });
}

function render(opts) {
  const map = BPromise.promisifyAll(new mbgl.Map({
    request: createMapRequestFunc(opts.accessToken),
    ratio: opts.ratio,
  }));

  return getStyle(opts.style, opts.accessToken)
    .then(style => map.load(style))
    .then(() => map.renderAsync(opts))
    .then((buffer) => {
      map.release();

      return sharp(buffer, {
        raw: {
          width: Math.floor(opts.width * opts.ratio),
          height: Math.floor(opts.height * opts.ratio),
          channels: 4,
        },
      });
    });
}

function getStyle(url, accessToken) {
  if (_.startsWith(url, 'mapbox:')) {
    url = resolveUrl({
      kind: mbgl.Resource.Style,
      url: url,
    }, accessToken);
  }

  if (_.startsWith(url, 'http')) {
    return requestAsync({
      url: url,
      json: true,
    })
    .then(res => res.body);
  }

  return readJsonFile(url);
}

function resolveUrl(req, accessToken) {
  switch (req.kind) {
    case mbgl.Resource.Style:
      return mbutil.normalizeStyleURL(req.url, accessToken);
    case mbgl.Resource.Source:
      return mbutil.normalizeSourceURL(req.url, accessToken);
    case mbgl.Resource.Tile:
      // console.warn(`Unexpected Tile request: ${req}`);
      // https://a.tiles.mapbox.com/v4/mapbox.mapbox-streets-v6/2/1/1.vector.pbf?accessToken=
      return mbutil.normalizeVectorTileURL(req.url, accessToken);
    case mbgl.Resource.Glyphs:
      return mbutil.normalizeGlyphsURL(req.url, accessToken);
    case mbgl.Resource.SpriteImage:
      return mbutil.normalizeSpriteURL(stripSpriteUrl(req.url), '@2x', '.png', accessToken);
    case mbgl.Resource.SpriteJSON:
      return mbutil.normalizeSpriteURL(stripSpriteUrl(req.url), '@2x', '.json', accessToken);
  }

  throw new Error(`Unknown req.kind: ${JSON.stringify(req, null, 2)}`);
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

function createMapRequestFunc(accessToken) {
  return function requestFunc(req, callback) {
    var requestUrl;
    try {
      requestUrl = resolveUrl(req, accessToken);
    } catch (e) {
      return callback(e);
    }

    console.log('request url: ' + requestUrl);
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
          // Ignore Not found responses, they should be ok
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
  }
}

function readJsonFile(filePath) {
  return fs.readFileAsync(filePath, { encoding: 'utf8' })
    .then(content => JSON.parse(content));
}

if (require.main === module) {
  main();
}

module.exports = {
  render: render,
};
