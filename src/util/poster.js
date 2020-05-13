const BPromise = require('bluebird');
const path = require('path');
const _ = require('lodash');
const fs = BPromise.promisifyAll(require('fs'));
const {
  addOrUpdateLines,
  getPosterStyle,
  getMapStyle,
  changeDynamicAttributes,
  posterSizeToMiddleLineStrokeWidth,
} = require('alvarcarto-common');
const xmldom = require('xmldom');
const window = require('svgdom');
const svgJs = require('svg.js');
const config = require('../config');

// This padding factor needs to match the settings in frontend
const EMPTY_MAP_PADDING_FACTOR = 0.035;
const ONE_CM_IN_INCH = 0.393700787;
const PRINT_DPI = 300;
const SIZES_IN_INCHES = {
  A6: { width: 4.1, height: 5.8 },
  A5: { width: 5.8, height: 8.3 },
  A4: { width: 8.3, height: 11.7 },
  A3: { width: 11.7, height: 16.5 },
};
const NODE_TYPE_ELEMENT = 1;
const MAPNIK_RASTER_IMAGE_TYPES = ['png', 'jpg', 'webp'];
const SHARP_RASTER_IMAGE_TYPES = MAPNIK_RASTER_IMAGE_TYPES.concat(['heif', 'tiff']);

async function getPosterDimensions(opts) {
  const svgString = await readPosterFile(opts);
  const { svg } = parseSvgString(svgString);
  const originalSvgDimensions = getNodeDimensions(svg);

  const svgDimensions = getNodeDimensions(svg);
  if (opts.resizeToWidth) {
    const ratio = opts.resizeToWidth / svgDimensions.width;
    svgDimensions.height = Math.floor(svgDimensions.height * ratio);
    svgDimensions.width = opts.resizeToWidth;
  } else if (opts.resizeToHeight) {
    const ratio = opts.resizeToHeight / svgDimensions.height;
    svgDimensions.width = Math.floor(svgDimensions.width * ratio);
    svgDimensions.height = opts.resizeToHeight;
  }

  const side = Math.min(svgDimensions.width, svgDimensions.height);
  const padding = Math.floor(EMPTY_MAP_PADDING_FACTOR * side);

  return {
    width: svgDimensions.width,
    height: svgDimensions.height,
    originalWidth: originalSvgDimensions.width,
    originalHeight: originalSvgDimensions.height,

    // Used when no labels are printed
    padding,
  };
}

function transformPosterSvgDoc(svgDoc, opts = {}) {
  if (opts.labelsEnabled) {
    setTexts(svgDoc, opts);
  }

  changeDynamicAttributes(svgDoc, opts);
  if (opts.serialize) {
    return svgDocToString(svgDoc);
  }

  return svgDoc;
}

function svgDocToString(svgDoc) {
  const s = new xmldom.XMLSerializer();
  return s.serializeToString(svgDoc);
}

function setTexts(svgDoc, opts) {
  const { labelColor } = getMapStyle(opts.mapStyle);
  const { addLines, upperCaseLabels } = getPosterStyle(opts.posterStyle, opts.material);

  const labelHeader = upperCaseLabels
    ? opts.labelHeader.toUpperCase()
    : opts.labelHeader;
  const headerEl = svgDoc.getElementById('header');
  setText(headerEl, labelHeader);
  setColor(headerEl, labelColor);

  const smallHeaderEl = svgDoc.getElementById('small-header');
  if (smallHeaderEl) {
    const labelSmallHeader = upperCaseLabels
      ? opts.labelSmallHeader.toUpperCase()
      : opts.labelSmallHeader;
    setText(smallHeaderEl, labelSmallHeader);
    setColor(smallHeaderEl, labelColor);

    if (addLines) {
      const strokeWidth = opts.custom
        ? opts.custom.middleLineStrokeWidth
        : posterSizeToMiddleLineStrokeWidth(opts.size);

      addOrUpdateLines(svgDoc, getSvgFromDocument(svgDoc), smallHeaderEl, {
        getBBoxForSvgElement: textEl => getBBoxForSvgElement(svgDocToString(svgDoc), textEl.getAttribute('id')),
        svgAttributes: {
          'stroke-width': strokeWidth,
        },
        debugLines: config.DEBUG_POSTER_LINES,
      });
    }
  }

  const textEl = svgDoc.getElementById('text');
  if (textEl) {
    const labelText = upperCaseLabels
      ? opts.labelText.toUpperCase()
      : opts.labelText;
    setText(textEl, labelText);
    setColor(textEl, labelColor);
  }
}

function parseSvgString(svgString) {
  const doc = new xmldom.DOMParser().parseFromString(svgString, 'text/xml');

  return {
    svg: getSvgElement(doc),
    doc,
  };
}

function getSvgElement(doc) {
  const svgList = doc.getElementsByTagName('svg');
  if (svgList.length !== 1) {
    throw new Error(`Unexpected amount of svg tags found: ${svgList.length}`);
  }
  return svgList.item(0);
}

async function readPosterFile(opts = {}) {
  if (opts.custom) {
    return await fs.readFileAsync(opts.custom.filePath, { encoding: 'utf8' });
  }

  const serverFileName = `${opts.posterStyle}-${opts.size}-${opts.orientation}-server.svg`;
  const serverAbsPath = path.join(__dirname, '../../posters/dist', serverFileName);
  const clientFileName = `${opts.posterStyle}-${opts.size}-${opts.orientation}.svg`;
  const clientAbsPath = path.join(__dirname, '../../posters/dist', clientFileName);

  const serverFileExists = await fileExists(serverAbsPath);

  if (serverFileExists && !opts.clientVersion) {
    return fs.readFileAsync(serverAbsPath, { encoding: 'utf8' });
  }

  return fs.readFileAsync(clientAbsPath, { encoding: 'utf8' });
}

function fileExists(filePath) {
  return fs.statAsync(filePath)
    .then(stats => stats.isFile())
    .catch((err) => {
      if (err.code === 'ENOENT') {
        return false;
      }

      throw err;
    });
}

function getTempPath(relativePath) {
  // These temp files need to be in repository root.
  // Svg file references to png image under poster/dist/images, and
  // according to librsvg security rules, embedded images must be
  // in the directory path under the svg file.
  const absPath = path.join(__dirname, '../../', relativePath);
  return absPath;
}

// Note: this will ignore the width / height unit (for example `pt`)
// Mapnik SVG rendering returns SVG with point units
// https://github.com/mapnik/mapnik/issues/2269
// This shouldn't matter in our case as the relative units are still valid
function getNodeDimensions(node) {
  return {
    // TODO: Change this to float after everything is sorted
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

function getSvgFromDocument(doc) {
  const svgList = doc.getElementsByTagName('svg');
  if (svgList.length < 1) {
    throw new Error(`Unexpected amount of svg elements found: ${svgList.length}`);
  }

  return svgList.item(0);
}

function getFirstTspan(textNode) {
  const tspanList = textNode.getElementsByTagName('tspan');
  if (tspanList.length < 1) {
    throw new Error(`Unexpected amount of tspan elements found: ${tspanList.length}`);
  }

  return tspanList[0];
}

function getBBoxForSvgElement(svgText, elId) {
  const SVG = svgJs(window);
  const draw = SVG(window.document);
  draw.svg(svgText);

  const element = SVG.get(elId);
  const realEl = element.native();
  const tspanEl = getFirstTspan(realEl);
  const rbox = SVG.adopt(tspanEl).rbox();

  const letterSpacing = parseFloat(realEl.getAttribute('letter-spacing'));
  const text = tspanEl.textContent;
  return {
    x: rbox.x,
    y: rbox.y,
    // Add letter spacing values manually to the width of the bounding box.
    // x value doesn't need to be modified because of text-anchor=center
    // I tried to fix implementation of svgdom without success
    width: rbox.width + (letterSpacing * (text.length - 1)),
    height: rbox.height,
  };
}

function dimensionsToDefaultScale(widthPx, heightPx) {
  const minSide = Math.min(widthPx, heightPx);
  // This math returned similar scale results as manually
  // scaled ones before
  return Math.sqrt(minSide) / 18.2;
}

// Returns expected pixel dimensions for certain size, when
// we are printing at certain `PRINT_DPI` resolution.
function parseSizeToPixelDimensions(size, orientation) {
  if (_.has(SIZES_IN_INCHES, size)) {
    const { width, height } = SIZES_IN_INCHES[size];

    return resolveOrientation({
      width: Math.round(width * PRINT_DPI, 0),
      height: Math.round(height * PRINT_DPI, 0),
    }, orientation);
  }

  const parsed = parseSize(size);
  const widthInch = parsed.unit === 'cm' ? cmToInch(parsed.width) : parsed.width;
  const heightInch = parsed.unit === 'cm' ? cmToInch(parsed.height) : parsed.height;

  return resolveOrientation({
    width: Math.round(widthInch * PRINT_DPI, 0),
    height: Math.round(heightInch * PRINT_DPI, 0),
  }, orientation);
}

function parseSize(size) {
  if (!_.isString(size) || !size.match(/[0-9]+x[0-9]+(cm|inch)/)) {
    throw new Error(`Size should match /[0-9]+x[0-9]+(cm|inch)/, size: ${size}`);
  }

  const unit = size.slice(-2);
  const dimensionString = size.slice(0, -2);
  const splitted = dimensionString.split('x');
  const width = parseFloat(splitted[0], 10);
  const height = parseFloat(splitted[1], 10);
  return {
    unit,
    width,
    height,
  };
}

function resolveOrientation(dimensions, orientation) {
  if (orientation === 'landscape') {
    return _.merge({}, dimensions, {
      width: dimensions.height,
      height: dimensions.width,
    });
  }

  return dimensions;
}

function cmToInch(cm) {
  return cm * ONE_CM_IN_INCH;
}

module.exports = {
  getPosterDimensions,
  getNodeDimensions,
  transformPosterSvgDoc,
  parseSvgString,
  readPosterFile,
  getTempPath,
  parseSizeToPixelDimensions,
  svgDocToString,
  getSvgElement,
  dimensionsToDefaultScale,
  parseSize,
  NODE_TYPE_ELEMENT,
  SHARP_RASTER_IMAGE_TYPES,
  MAPNIK_RASTER_IMAGE_TYPES,
};
