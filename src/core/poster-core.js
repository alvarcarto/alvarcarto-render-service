const BPromise = require('bluebird');
const _ = require('lodash');
const sharp = require('sharp');
const glob = require('glob');
const path = require('path');
const uuid = require('node-uuid');
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
const rasterMapCore = require('./raster-map-core');
const config = require('../config');

// This needs to match the settings in frontend
const EMPTY_MAP_PADDING_FACTOR = 0.035;

const files = glob.sync(`${config.FONT_DIR}/*.ttf`);
const fontMapping = _.reduce(files, (memo, filePath) => {
  const fontName = path.basename(filePath, '.ttf');
  const fileName = path.basename(filePath);
  const newFonts = { [fontName]: fileName };
  if (_.endsWith(fontName, '-Regular')) {
    const baseName = fontName.split('-Regular')[0];
    newFonts[baseName] = fileName;
  }
  return _.extend({}, memo, newFonts);
}, {});

window.setFontDir(config.FONT_DIR)
  .setFontFamilyMappings(fontMapping);

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
  const tmpSvgPath = getAbsPath(`${opts.uuid}.svg`);
  return BPromise.all([
    fs.unlinkAsync(tmpSvgPath),
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
    dimensions: getPosterDimensions(opts),
    mapMeta: sharp(opts.mapImage).metadata(),
  })
    .then((result) => {
      const parsed = parsePosterSvg(result.svgString);
      const { dimensions } = result;
      const expected = `${dimensions.width}x${dimensions.height}`;
      const actual = `${result.mapMeta.width}x${result.mapMeta.height}`;
      if (expected !== actual) {
        throw new Error(`Map image has incorrect dimensions: ${actual}, expected: ${expected}`);
      }

      const newSvgString = transformPosterSvgDoc(parsed.doc, opts);
      const tmpSvgPath = getAbsPath(`${opts.uuid}.svg`);
      return BPromise.props({
        mapImage: opts.mapImage,
        poster: fs.writeFileAsync(tmpSvgPath, newSvgString, { encoding: 'utf-8' }),
        svg: parsed.svg,
        dimensions,
      });
    })
    .then((result) => {
      const { dimensions } = result;
      const tmpSvgPath = getAbsPath(`${opts.uuid}.svg`);
      return BPromise.props({
        svgImage:
          sharp(tmpSvgPath, { density: 72 })
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
      console.log('start dimensions', svgDimensions);
      console.log('opts.resizeToWidth', opts.resizeToWidth);
      console.log('opts.resizeToHeight', opts.resizeToHeight);
      if (opts.resizeToWidth) {
        const ratio = svgDimensions.width / opts.resizeToWidth;
        svgDimensions.height = Math.floor(svgDimensions.height * ratio);
        svgDimensions.width = opts.resizeToWidth;
      } else if (opts.resizeToHeight) {
        const ratio = svgDimensions.height / opts.resizeToHeight;
        svgDimensions.width = Math.floor(svgDimensions.width * ratio);
        svgDimensions.height = opts.resizeToHeight;
      }

      console.log('final dimensions', svgDimensions);

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
  return svgDocToStr(svgDoc);
}

function svgDocToStr(svgDoc) {
  const s = new xmldom.XMLSerializer();
  return s.serializeToString(svgDoc);
}

function setTexts(svgDoc, opts) {
  const { labelColor } = getMapStyle(opts.mapStyle);
  const { addLines, upperCaseLabels } = getPosterStyle(opts.posterStyle);


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
      addOrUpdateLines(svgDoc, getSvgFromDocument(svgDoc), smallHeaderEl, {
        getBBoxForSvgElement: textEl => getBBoxForSvgElement(svgDocToStr(svgDoc), textEl.getAttribute('id')),
        svgAttributes: {
          'stroke-width': posterSizeToMiddleLineStrokeWidth(opts.size),
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

function getAbsPath(relativePath) {
  const absPath = path.join(__dirname, '../..', relativePath);
  return absPath;
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

function getSvgFromDocument(doc) {
  const svgList = doc.getElementsByTagName('svg');
  if (svgList.length < 1) {
    throw new Error(`Unexpected amount of svg elements found: ${svgList.length}`);
  }

  return svgList.item(0);
}

function _getFirstTspan(textNode) {
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
  const tspanEl = _getFirstTspan(realEl);
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

module.exports = {
  render,
};
