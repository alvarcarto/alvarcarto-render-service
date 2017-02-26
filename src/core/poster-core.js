const BPromise = require('bluebird');
const _ = require('lodash');
const sharp = require('sharp');
const path = require('path');
const fs = BPromise.promisifyAll(require('fs'));
const rasterMapCore = require('./raster-map-core');
const logger = require('../util/logger')(__filename);
const xmldom = require('xmldom');

const EMPTY_MAP_PADDING_FACTOR = 0.03;

function render(opts) {
  if (opts.labelsEnabled) {
    return _normalRender(opts);
  }

  return _renderWithoutLabels(opts);
}

function _renderWithoutLabels(opts) {
  return getPosterMapImageWithoutLabelsDimensions(opts)
    .then((dimensions) => {
      const mapOpts = _.merge({}, opts, {
        width: dimensions.width,
        height: dimensions.height,
      });

      return BPromise.props({
        mapImage: rasterMapCore.render(_.omit(mapOpts, _.isNil)),
        dimensions,
      });
    })
    .then(({ mapImage, dimensions }) =>
      sharp(mapImage)
        .background({ r: 255, g: 255, b: 255 })
        .extend({
          top: dimensions.padding,
          right: dimensions.padding,
          bottom: dimensions.padding,
          left: dimensions.padding,
        })
        .png()
        .toBuffer(),
    );
}

function _normalRender(opts) {
  return getPosterMapImageDimensions(opts)
    .then((dimensions) => {
      const mapOpts = _.merge({}, opts, {
        width: dimensions.width,
        height: dimensions.height,
      });

      return rasterMapCore.render(_.omit(mapOpts, _.isNil));
    })
    .then((mapImage) => {
      const posterOpts = _.merge({}, opts, {
        mapImage,
      });

      return _renderPoster(posterOpts);
    });
}

function _renderPoster(opts) {
  return BPromise.props({
    svgString: readPosterFile(opts),
    mapMeta: sharp(opts.mapImage).metadata(),
  })
    .then((result) => {
      const parsed = parsePosterSvg(result.svgString);
      const { image } = parsed;
      const dimensions = getDimensions(image);
      const expected = `${dimensions.width}x${dimensions.height}`;
      const actual = `${result.mapMeta.width}x${result.mapMeta.height}`;
      if (expected !== actual) {
        throw new Error(`Image has incorrect dimensions: ${actual}, expected: ${expected}`);
      }

      const newSvgString = transformPosterSvgDoc(opts, parsed.doc);
      return BPromise.props({
        map: fs.writeFileAsync('map.png', opts.mapImage, { encoding: 'binary' }),
        poster: fs.writeFileAsync('poster.svg', newSvgString, { encoding: 'utf-8' }),
        svg: parsed.svg,
      });
    })
    .then((result) => {
      const dimensions = getDimensions(result.svg);
      return sharp('poster.svg', { density: 72 })
        .limitInputPixels(false)
        .resize(dimensions.width, dimensions.height)
        .png()
        .toBuffer();
    });
}

function getPosterMapImageDimensions(opts) {
  return readPosterFile(opts)
    .then((svgString) => {
      const { image } = parsePosterSvg(svgString);
      return getDimensions(image);
    });
}

function getPosterMapImageWithoutLabelsDimensions(opts) {
  return readPosterFile(opts)
    .then((svgString) => {
      const { svg } = parsePosterSvg(svgString);
      const svgDimensions = getDimensions(svg);
      const side = Math.min(svgDimensions.width, svgDimensions.height);
      const padding = Math.floor(EMPTY_MAP_PADDING_FACTOR * side);
      return {
        width: svgDimensions.width - (2 * padding),
        height: svgDimensions.height - (2 * padding),
        padding,
      };
    });
}

function transformPosterSvgDoc(opts, svgDoc) {
  const list = svgDoc.getElementsByTagName('image');
  const image = list.item(0);
  image.setAttribute('xlink:href', 'map.png');

  if (opts.labelsEnabled) {
    setText(svgDoc.getElementById('header'), opts.labelHeader);
    setText(svgDoc.getElementById('small-header'), opts.labelSmallHeader);
    setText(svgDoc.getElementById('text'), opts.labelText);
  }

  const s = new xmldom.XMLSerializer();
  return s.serializeToString(svgDoc);
}

function parsePosterSvg(svgString) {
  const doc = new xmldom.DOMParser().parseFromString(svgString, 'text/xml');
  const imgList = doc.getElementsByTagName('image');
  if (imgList.length !== 1) {
    throw new Error(`Unexpected amount of image tags found: ${imgList.length}`);
  }

  const svgList = doc.getElementsByTagName('svg');
  if (svgList.length !== 1) {
    throw new Error(`Unexpected amount of svg tags found: ${svgList.length}`);
  }

  return {
    image: imgList.item(0),
    svg: svgList.item(0),
    doc,
  };
}

function readPosterFile(opts) {
  const fileName = `${opts.style}-${opts.size}-${opts.orientation}.svg`;
  const absPath = path.join(__dirname, '../../posters', fileName);
  return fs.readFileAsync(absPath, { encoding: 'utf8' });
}

function getDimensions(node) {
  return {
    width: parseInt(node.getAttribute('width'), 10),
    height: parseInt(node.getAttribute('height'), 10),
  };
}

function setText(textNode, value) {
  const tspanList = textNode.getElementsByTagName('tspan');
  if (tspanList.length < 1) {
    throw new Error(`Unexpected amount of tspan elements found: ${tspanList.length}`);
  }

  tspanList.item(0).textContent = value;
}

function removeNode(node) {
  node.parentNode.removeChild(node);
}

module.exports = {
  render,
  getPosterMapImageDimensions,
  getPosterMapImageWithoutLabelsDimensions,
};
