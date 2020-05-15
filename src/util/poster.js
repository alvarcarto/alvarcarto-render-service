const BPromise = require('bluebird');
const path = require('path');
const glob = require('glob');
const _ = require('lodash');
const querystring = require('querystring');
const fs = BPromise.promisifyAll(require('fs'));
const fontkit = require('fontkit');
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
const logger = require('../util/logger')(__filename);

BPromise.promisifyAll(fontkit);

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

  return {
    width: svgDimensions.width,
    height: svgDimensions.height,
    originalWidth: originalSvgDimensions.width,
    originalHeight: originalSvgDimensions.height,

    // Used when no labels are printed
    padding: calculatePadding(svgDimensions),
  };
}

const openTypeFonts = glob.sync(`${config.FONT_DIR}/*.otf`);
const trueTypeFonts = glob.sync(`${config.FONT_DIR}/*.ttf`);
const FONT_FILES = trueTypeFonts.concat(openTypeFonts);

function getFontMapping() {
  const fontMapping = _.reduce(FONT_FILES, (memo, filePath) => {
    const fontName = path.basename(filePath, path.extname(filePath));
    const fileName = path.basename(filePath);
    const newFonts = { [fontName]: fileName };
    if (_.endsWith(fontName, '-Regular')) {
      const baseName = fontName.split('-Regular')[0];
      newFonts[baseName] = fileName;
    }
    return _.extend({}, memo, newFonts);
  }, {});

  return fontMapping;
}

function calculatePadding(dims) {
  const side = Math.min(dims.width, dims.height);
  return Math.floor(EMPTY_MAP_PADDING_FACTOR * side);
}

async function transformPosterSvgDoc(svgDoc, opts = {}) {
  if (opts.labelsEnabled) {
    await setTexts(svgDoc, opts);
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

// Traverses whole node tree "down" depth-first starting from node.
// Callback is called for each found node
function traverse(doc, node, cb) {
  cb(node);

  if (node.hasChildNodes()) {
    for (let i = 0; i < node.childNodes.length; ++i) {
      const childNode = node.childNodes.item(i);
      traverse(doc, childNode, cb);
    }
  }
}

function getSvgDocFonts(svgDoc) {
  const fonts = [];
  const svgEl = getSvgElement(svgDoc);
  traverse(svgDoc, svgEl, (node) => {
    if (node.nodeType !== NODE_TYPE_ELEMENT || !node.hasAttributes()) {
      return;
    }

    const fontFamily = node.getAttribute('font-family');
    if (_.isString(fontFamily) && fontFamily.trim().length > 0) {
      const nodeFonts = fontFamily.split(',');
      _.forEach(nodeFonts, (fontAttribute) => {
        const cleaned = fontAttribute.replace(/'/g, '').replace(/"/g, '').trim();
        fonts.push(cleaned);
      });
    }
  });

  return _.uniq(fonts);
}

function matchFont(fontName, fontMapping) {
  const cleanName = fontName.replace(/'/g, '').replace(/"/g, '').trim();
  if (_.has(fontMapping, cleanName)) {
    return fontMapping[cleanName];
  }

  const noSpaceName = cleanName.replace(/ /g, '');
  if (_.has(fontMapping, noSpaceName)) {
    return fontMapping[noSpaceName];
  }

  throw new Error(`Font mapping is missing font: ${fontName}`);
}

function pickNotoVariation(fontFamily) {
  const variations = ['-Black', '-Bold', '-DemiLight', '-Light', '-Thin', '-Medium', '-Regular'];

  for (let i = 0; i < variations.length; i += 1) {
    if (_.includes(fontFamily, variations[i])) {
      return `NotoSansSC${variations[i]}`;
    }
  }

  return 'NotoSansSC-Regular';
}

function getFirstFontFamily(fontFamily) {
  if (!_.isString(fontFamily) || fontFamily.trim().length === 0) {
    throw new Error(`Invalid font-family: ${fontFamily}`);
  }
  const fonts = fontFamily.split(',');
  const cleaned = fonts[0].replace(/'/g, '').replace(/"/g, '').trim();
  return cleaned;
}

async function setTexts(svgDoc, opts) {
  const { labelColor } = getMapStyle(opts.mapStyle);
  const { addLines, upperCaseLabels } = getPosterStyle(opts.posterStyle, opts.material);

  const labelHeader = upperCaseLabels
    ? opts.labelHeader.toUpperCase()
    : opts.labelHeader;
  const headerEl = svgDoc.getElementById('header');
  await setText(headerEl, labelHeader);
  setColor(headerEl, labelColor);

  const smallHeaderEl = svgDoc.getElementById('small-header');
  if (smallHeaderEl) {
    const labelSmallHeader = upperCaseLabels
      ? opts.labelSmallHeader.toUpperCase()
      : opts.labelSmallHeader;
    await setText(smallHeaderEl, labelSmallHeader);
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
    await setText(textEl, labelText);
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

function trimQuotes(str) {
  const cleaned = _.trimEnd(_.trimStart(str, '\'"'), '\'"');
  return cleaned;
}

async function maybeSetFallbackFont(textNode, text) {
  const tspanList = textNode.getElementsByTagName('tspan');

  const textFontFamily = textNode.getAttribute('font-family');
  const tspanFontFamily = tspanList.item(0).getAttribute('font-family');
  const fontFamily = _.isString(tspanFontFamily) && tspanFontFamily.trim().length > 0
    ? trimQuotes(tspanFontFamily.trim())
    : trimQuotes(textFontFamily.trim());

  const fontFamilyArr = _.map(fontFamily.split(','), i => i.trim());

  await BPromise.each(fontFamilyArr, async (fontName) => {
    const fontFile = matchFont(fontName, getFontMapping());
    const fontPath = path.join(config.FONT_DIR, fontFile);
    const font = await fontkit.openAsync(fontPath);

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      // https://stackoverflow.com/questions/48009201/how-to-get-the-unicode-code-point-for-a-character-in-javascript
      const codePointNums = Array.from(char).map(v => v.codePointAt(0));

      for (let k = 0; k < codePointNums.length; k += 1) {
        const codePointNum = codePointNums[k];
        if (!font.hasGlyphForCodePoint(codePointNum)) {
          const chosenNoto = pickNotoVariation(fontFamily);
          const newFontFamily = `'${chosenNoto},${fontFamily}'`;
          let msg = `Setting fallback font-family first (${newFontFamily}) for element #${textNode.getAttribute('id')},`;
          msg += ` found '${char}' (code point ${codePointNum})`;
          logger.info(msg);
          tspanList.item(0).setAttribute('font-family', newFontFamily);
          textNode.setAttribute('font-family', newFontFamily);

          // We can stop iteration here, fall back font already sent
          // We just assume that all glyphs are found from our fallback font
          //
          // To improve this support, we should separate the text to different elements
          // based on what glyphs the text contains.
          // For example "東京都 🙂" should be two separate elements where each have their own fonts
          // All this is only necessary to support vector PDF format correctly.
          // In most cases our dumb approach is good enough, our customer production already
          // handles font mixups (via librsvg rendering)
          return;
        }
      }
    }
  });
}

async function setText(textNode, value) {
  const tspanList = textNode.getElementsByTagName('tspan');
  if (tspanList.length < 1) {
    throw new Error(`Unexpected amount of tspan elements found: ${tspanList.length}`);
  }

  await maybeSetFallbackFont(textNode, value);

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
  if (_.has(SIZES_IN_INCHES, size)) {
    const dim = SIZES_IN_INCHES[size];
    return {
      width: dim.width,
      height: dim.height,
      unit: 'inch',
    };
  }

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

function posterMetaQuery(opts) {
  const meta = {
    swLat: Number(opts.bounds.southWest.lat).toFixed(4),
    swLng: Number(opts.bounds.southWest.lng).toFixed(4),
    neLat: Number(opts.bounds.northEast.lat).toFixed(4),
    neLng: Number(opts.bounds.northEast.lng).toFixed(4),
    size: opts.size,
    mapStyle: opts.mapStyle,
    posterStyle: opts.posterStyle,
    material: opts.material,
    orientation: opts.orientation,
    labelsEnabled: opts.labelsEnabled,
    labelHeader: opts.labelHeader,
    labelSmallHeader: opts.labelSmallHeader,
    labelText: opts.labelText,
    mapnikScale: Number(opts.scale).toFixed(2),
  };
  return querystring.stringify(meta);
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
  traverse,
  readPosterFile,
  getTempPath,
  matchFont,
  calculatePadding,
  parseSizeToPixelDimensions,
  svgDocToString,
  getFontMapping,
  getSvgDocFonts,
  getFirstFontFamily,
  pickNotoVariation,
  getSvgElement,
  posterMetaQuery,
  dimensionsToDefaultScale,
  parseSize,
  NODE_TYPE_ELEMENT,
  SHARP_RASTER_IMAGE_TYPES,
  MAPNIK_RASTER_IMAGE_TYPES,
};
