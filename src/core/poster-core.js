const BPromise = require('bluebird');
const _ = require('lodash');
const sharp = require('sharp');
const path = require('path');
const uuid = require('node-uuid');
const fs = BPromise.promisifyAll(require('fs'));
const {
  addOrUpdateLines,
  getPosterLook,
  getMapStyle,
  changeDynamicAttributes,
} = require('alvarcarto-common');
const window = require('svgdom');
const svgJs = require('svg.js');
const rasterMapCore = require('./raster-map-core');
const xmldom = require('xmldom');

// This needs to match the settings in frontend
const EMPTY_MAP_PADDING_FACTOR = 0.03;

function render(_opts) {
  const opts = _.merge(_opts, {
    uuid: uuid.v4(),
  });

  if (opts.labelsEnabled) {
    return _normalRender(opts)
      .finally(() => _deleteFiles(opts));
  }

  return _renderWithoutLabels(opts)
    .finally(() => _deleteFiles(opts));
}

function _deleteFiles(opts) {
  return BPromise.all([
    fs.unlinkAsync(`${opts.uuid}.svg`),
  ])
    .catch((err) => {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    });
}

function _renderWithoutLabels(opts) {
  return _renderMap(opts)
    // Add white borders on top of map image
    .then(({ mapImage, dimensions }) =>
      sharp(mapImage)
        .extract({
          left: dimensions.padding,
          top: dimensions.padding,
          width: dimensions.width - (2 * dimensions.padding),
          height: dimensions.height - (2 * dimensions.padding),
        })
        .background({ r: 255, g: 255, b: 255 })
        .extend(dimensions.padding)
        .png()
        .toBuffer(),
    );
}

function _normalRender(opts) {
  return _renderMap(opts)
    .then(({ mapImage }) => {
      const posterOpts = _.merge({}, opts, {
        mapImage,
      });

      return _renderPoster(posterOpts);
    });
}

function _renderMap(opts) {
  return getPosterDimensions(opts)
    .then((dimensions) => {
      const mapOpts = _.merge({}, opts, {
        width: dimensions.width,
        height: dimensions.height,
      });

      return BPromise.props({
        mapImage: rasterMapCore.render(_.omit(mapOpts, _.isNil)),
        dimensions,
      });
    });
}

function _renderPoster(opts) {
  return BPromise.props({
    svgString: readPosterFile(opts),
    mapMeta: sharp(opts.mapImage).metadata(),
  })
    .then((result) => {
      const parsed = parsePosterSvg(result.svgString);
      const { svg } = parsed;
      const dimensions = getDimensions(svg);
      const expected = `${dimensions.width}x${dimensions.height}`;
      const actual = `${result.mapMeta.width}x${result.mapMeta.height}`;
      if (expected !== actual) {
        throw new Error(`Map image has incorrect dimensions: ${actual}, expected: ${expected}`);
      }

      const newSvgString = transformPosterSvgDoc(parsed.doc, opts);
      return BPromise.props({
        mapImage: opts.mapImage,
        poster: fs.writeFileAsync(`${opts.uuid}.svg`, newSvgString, { encoding: 'utf-8' }),
        svg: parsed.svg,
      });
    })
    .then((result) => {
      const dimensions = getDimensions(result.svg);
      return BPromise.props({
        svgImage:
          sharp(`${opts.uuid}.svg`, { density: 72 })
            .limitInputPixels(false)
            .resize(dimensions.width, dimensions.height)
            .png()
            .toBuffer(),
        mapImage: result.mapImage,
      });
    })
    .then(result =>
      sharp(result.mapImage)
        .overlayWith(result.svgImage, {
          top: 0,
          left: 0,
        })
        .png()
        .toBuffer(),
    );
}

function getPosterDimensions(opts) {
  return readPosterFile(opts)
    .then((svgString) => {
      const { svg } = parsePosterSvg(svgString);
      const svgDimensions = getDimensions(svg);
      const side = Math.min(svgDimensions.width, svgDimensions.height);
      const padding = Math.floor(EMPTY_MAP_PADDING_FACTOR * side);

      return {
        width: svgDimensions.width,
        height: svgDimensions.height,

        // Used when no labels are printed
        padding,
      };
    });
}

function transformPosterSvgDoc(svgDoc, opts) {
  if (opts.labelsEnabled) {
    setTexts(svgDoc, opts);
  }

  changeDynamicAttributes(svgDoc, opts);

  const s = new xmldom.XMLSerializer();
  return s.serializeToString(svgDoc);
}

function setTexts(svgDoc, opts) {
  const { labelColor } = getMapStyle(opts.mapStyle);

  const headerEl = svgDoc.getElementById('header');
  setText(headerEl, opts.labelHeader);
  setColor(headerEl, labelColor);

  const smallHeaderEl = svgDoc.getElementById('small-header');
  if (smallHeaderEl) {
    setText(smallHeaderEl, opts.labelSmallHeader);
    setColor(smallHeaderEl, labelColor);

    const { addLines } = getPosterLook(opts.posterStyle);
    if (addLines) {
      addOrUpdateLines(svgDoc, svgDoc.querySelector('svg'), smallHeaderEl, {
        getBBoxForSvgElement,
        svgAttributes: {
          stroke: '#2d2d2d',
          'stroke-width': '6px',
          'stroke-linecap': 'square',
        },
      });
    }
  }

  const textEl = svgDoc.getElementById('text');
  if (textEl) {
    setText(textEl, opts.labelText);
    setColor(textEl, labelColor);
  }
}

function parsePosterSvg(svgString) {
  const doc = new xmldom.DOMParser().parseFromString(svgString, 'text/xml');
  const svgList = doc.getElementsByTagName('svg');
  if (svgList.length !== 1) {
    throw new Error(`Unexpected amount of svg tags found: ${svgList.length}`);
  }

  return {
    svg: svgList.item(0),
    doc,
  };
}

function readPosterFile(opts) {
  const fileName = `${opts.posterStyle}-${opts.size}-${opts.orientation}.svg`;
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

function setColor(textNode, value) {
  textNode.setAttribute('fill', value);
}

function getBBoxForSvgElement(svgText, elId) {
  const SVG = svgJs(window);
  const document = window.document;
  const draw = SVG(document.documentElement);
  draw.svg(svgText);

  const element = draw.get(elId);
  return element.bbox();
}

module.exports = {
  render,
};
