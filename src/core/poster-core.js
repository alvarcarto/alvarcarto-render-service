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
const rasterMapCorePool = require('./raster-map-core-pool');
const rasterTileMapCore = require('./raster-tile-map-core');
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
  const opts = _.merge({
    useTileRender: false,
    material: 'paper',
  }, _opts, {
    uuid: uuid.v4(),
  });

  const isSmallWidth = _.isFinite(opts.resizeToWidth) && opts.resizeToWidth < 300;
  const isSmallHeight = _.isFinite(opts.resizeToHeight) && opts.resizeToHeight < 300;
  if (isSmallWidth || isSmallHeight) {
    opts.useTileRender = true;
  }

  if (opts.labelsEnabled) {
    return _normalRender(opts)
      .finally(() => _deleteFiles(opts));
  }

  return _renderWithoutLabels(opts)
    .finally(() => _deleteFiles(opts));
}

function _deleteFiles(opts) {
  if (config.SAVE_TEMP_FILES) {
    return BPromise.resolve();
  }

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
      sharp(mapImage, { limitInputPixels: false })
        .extract({
          left: dimensions.padding,
          top: dimensions.padding,
          width: dimensions.width - (2 * dimensions.padding),
          height: dimensions.height - (2 * dimensions.padding),
        })
        .extend({
          top: dimensions.padding,
          left: dimensions.padding,
          right: dimensions.padding,
          bottom: dimensions.padding,
          background: { r: 255, g: 255, b: 255 },
        })
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
      // If resize parameters are defined, use map pooling
      if (!opts.resizeToWidth && !opts.resizeToHeight) {
        return BPromise.props({
          mapImage: rasterMapCore.render(_.omit(mapOpts, _.isNil)),
          dimensions,
        });
      }

      if (!opts.useTileRender) {
        let scale = opts.scale;

        if (opts.resizeToWidth) {
          const ratio = opts.resizeToWidth / dimensions.originalWidth;
          scale *= ratio;
        } else if (opts.resizeToHeight) {
          const ratio = opts.resizeToHeight / dimensions.originalHeight;
          scale *= ratio;
        }

        return BPromise.props({
          mapImage: rasterMapCorePool.render(_.omit(_.merge({}, mapOpts, { scale }), _.isNil)),
          dimensions,
        });
      }

      return BPromise.props({
        mapImage: rasterTileMapCore.render(mapOpts),
        dimensions,
      });
    })
    .tap((result) => {
      if (config.SAVE_TEMP_FILES) {
        const tmpPngPath = getAbsPath(`${opts.uuid}-map.png`);
        return fs.writeFileAsync(tmpPngPath, result.mapImage, { encoding: 'binary' });
      }

      return BPromise.resolve();
    });
}

function _renderPoster(opts) {
  return BPromise.props({
    svgString: readPosterFile(opts),
    dimensions: getPosterDimensions(opts),
    mapMeta: sharp(opts.mapImage, { limitInputPixels: false }).metadata(),
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
          sharp(tmpSvgPath, { density: 72, limitInputPixels: false })
            .resize(dimensions.width, dimensions.height)
            .png()
            .toBuffer(),
        mapImage: result.mapImage,
      });
    })
    .tap((result) => {
      if (config.SAVE_TEMP_FILES) {
        const tmpPngPath = getAbsPath(`${opts.uuid}-svg.png`);
        return fs.writeFileAsync(tmpPngPath, result.svgImage, { encoding: 'binary' });
      }

      return BPromise.resolve();
    })
    .then(result =>
      sharp(result.mapImage, { limitInputPixels: false })
        .composite([{
          input: result.svgImage,
          top: 0,
          left: 0,
        }])
        .png()
        .toBuffer(),
    )
    .tap((image) => {
      if (config.SAVE_TEMP_FILES) {
        const tmpPngPath = getAbsPath(`${opts.uuid}-combined.png`);
        return fs.writeFileAsync(tmpPngPath, image, { encoding: 'binary' });
      }

      return BPromise.resolve();
    });
}

function getPosterDimensions(opts) {
  return readPosterFile(opts)
    .then((svgString) => {
      const { svg } = parsePosterSvg(svgString);
      const originalSvgDimensions = getDimensions(svg);

      const svgDimensions = getDimensions(svg);
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
        getBBoxForSvgElement: textEl => getBBoxForSvgElement(svgDocToStr(svgDoc), textEl.getAttribute('id')),
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
  if (opts.custom) {
    return fs.readFileAsync(opts.custom.filePath, { encoding: 'utf8' });
  }

  const serverFileName = `${opts.posterStyle}-${opts.size}-${opts.orientation}-server.svg`;
  const serverAbsPath = path.join(__dirname, '../../posters/dist', serverFileName);
  const clientFileName = `${opts.posterStyle}-${opts.size}-${opts.orientation}.svg`;
  const clientAbsPath = path.join(__dirname, '../../posters/dist', clientFileName);

  return fileExists(serverAbsPath)
    .then((serverFileExists) => {
      if (serverFileExists) {
        return fs.readFileAsync(serverAbsPath, { encoding: 'utf8' });
      }

      return fs.readFileAsync(clientAbsPath, { encoding: 'utf8' });
    });
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
