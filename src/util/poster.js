const BPromise = require('bluebird');
const path = require('path');
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

// This needs to match the settings in frontend
const EMPTY_MAP_PADDING_FACTOR = 0.035;

async function getPosterDimensions(opts) {
  const svgString = await readPosterFile(opts);
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

async function readPosterFile(opts) {
  if (opts.custom) {
    return await fs.readFileAsync(opts.custom.filePath, { encoding: 'utf8' });
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

function getTempPath(relativePath) {
  const absPath = path.join(__dirname, '../../tmp-files/', relativePath);
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

module.exports = {
  getPosterDimensions,
  transformPosterSvgDoc,
  parsePosterSvg,
  readPosterFile,
  getTempPath,
};
