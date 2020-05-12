const fs = require('fs');
const BPromise = require('bluebird');
const path = require('path');
const uuid = require('node-uuid');
const _ = require('lodash');
const mapnik = require('mapnik');
const logger = require('../util/logger')(__filename);
const { replacePostgisParametersFile } = require('../util/mapnik');
const config = require('../config');

BPromise.promisifyAll(fs);

mapnik.register_default_fonts();
mapnik.register_default_input_plugins();
if (config.DEBUG_MAPNIK) {
  mapnik.Logger.setSeverity(mapnik.Logger.DEBUG);
}

function getAbsPath(relativePath) {
  const absPath = path.join(__dirname, '../..', relativePath);
  return absPath;
}

async function render(_opts) {
  const opts = _.merge({
    map: null,
    scale: 1,
    stylesheetPath: path.join(config.STYLE_DIR, `${_opts.mapStyle}.xml`),
  }, _opts);

  let format = opts.format;
  if (format === 'jpg') {
    format = 'jpeg';
  }

  if (!_.includes(['png', 'jpeg', 'svg', 'pdf'], format)) {
    throw new Error(`Unsupported map format: ${format}`);
  }

  let mapInstance;
  if (opts.map) {
    logger.info('Reusing given mapnik map instance ..');
    mapInstance = BPromise.promisifyAll(opts.map);
  } else {
    logger.info('Creating a new mapnik map instance ..');
    const newMap = BPromise.promisifyAll(new mapnik.Map(opts.width, opts.height));
    const newStyleFilePath = await replacePostgisParametersFile(opts.stylesheetPath);
    mapInstance = await newMap.loadAsync(newStyleFilePath, {
      strict: true,
    });
  }

  const merc = new mapnik.Projection('+init=epsg:3857');
  /*
    bounds: {
      southWest: { lat: .., lng: .. },
      northEast: { lat: .., lng: .. },
    }
  */
  const coord1 = merc.forward([opts.bounds.southWest.lng, opts.bounds.southWest.lat]);
  const coord2 = merc.forward([opts.bounds.northEast.lng, opts.bounds.northEast.lat]);
  const extent = coord1.concat(coord2);
  mapInstance.extent = extent;

  if (format === 'png' || format === 'jpeg') {
    const image = BPromise.promisifyAll(new mapnik.Image(opts.width, opts.height));
    await mapInstance.renderAsync(image, { scale: opts.scale });
    const encoded = await image.encodeAsync(format);
    return encoded;
  }

  // Here's the code for render method, it didn't seem like it would support PDF or SVG
  // output. renderFile method was guided in one issue by library author.
  // https://github.com/mapnik/node-mapnik/blob/v3.7.2/src/mapnik_map.cpp#L1662
  const tmpUuid = uuid.v4();
  const tmpFilePath = getAbsPath(`map-${tmpUuid}.${opts.format}`);
  await mapInstance.renderFileAsync(tmpFilePath, { scale: opts.scale, format });
  const fileBuf = await fs.readFileAsync(tmpFilePath, { encoding: null });
  await fs.unlinkAsync(tmpFilePath);
  return fileBuf;
}

module.exports = {
  render,
};
