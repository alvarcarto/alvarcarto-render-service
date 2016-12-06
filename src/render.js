
const fs = require('fs');
const mbgl = require('../../mapbox-gl-native-latest');
const sharp = require('sharp');
const request = require('request');
const mbutil = require('./mapbox-util');
const BPromise = require('bluebird');

const RATIO = 4.0;

function main() {
  const accessToken = 'pk.eyJ1IjoiYWx2YXJjYXJ0byIsImEiOiJjaXdhb2s5Y24wMDJ6Mm9vNjVvNXdqeDRvIn0.wC2GAwpt9ggrV-mGAD_E0w';

  render({
    accessToken: accessToken,
    ratio: RATIO,
    width: 2000,
    height: 2000,
    zoom: 12.5,
    pitch: 60,
    bearing: -54,
    center: [24.941,60.166],
    style: './styles/blueprint/blueprint.json',
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

  try {
    map.load(readJsonFileSync(opts.style));
  } catch (e) {
    return BPromise.reject(e);
  }

  //map.setCenter(opts.center);
  console.log(opts);
  return map.renderAsync(opts)
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

function resolveUrl(req, accessToken) {
  switch (req.kind) {
    case mbgl.Resource.Style:
      return mbutil.normalizeStyleURL(req.url, accessToken);
    case mbgl.Resource.Source:
      return mbutil.normalizeSourceURL(req.url, accessToken);;
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

function readJsonFileSync(filePath) {
  const content = fs.readFileSync(filePath, { encoding: 'utf8' });
  return JSON.parse(content);
}

if (require.main === module) {
  main();
}
