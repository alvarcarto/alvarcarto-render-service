const BPromise = require('bluebird');
const _ = require('lodash');
const glob = require('glob');
const path = require('path');
const fs = BPromise.promisifyAll(require('fs'));
const xmldom = require('xmldom');

const ONE_CM_IN_INCH = 0.393700787;
const PRINT_DPI = 300;

function main() {
  const filePaths = glob.sync(path.join(__dirname, '../posters') + '/*');
  console.log(`Found ${filePaths.length} posters, validating and sanitizing .. `);

  BPromise.each(filePaths, filePath => {
    if (!_.endsWith(filePath, '.svg')) {
      throw new Error(`Poster file with incorrect file format found: ${filePath}`);
    }

    console.log(`\nProcessing ${filePath} ..`);
    return _sanitizePoster(filePath);
  })
    .catch(err => {
      throw err
    });
}

function _sanitizePoster(filePath) {
  const { style, size, orientation } = parseFilePath(filePath);
  const expectedDimensions = parseSizeToPixelDimensions(size, orientation);

  return readFile(filePath)
    .then(svgString => {
      const parsed = parsePosterSvg(svgString);
      sanitizeSvgElements(parsed.doc);

      const svgDimensions = getDimensions(parsed.svg);
      const expected = `${expectedDimensions.width}x${expectedDimensions.height}`;
      const actual = `${svgDimensions.width}x${svgDimensions.height}`;
      if (expected !== actual) {
        throw new Error(`SVG has incorrect dimensions: ${actual}, expected: ${expected}`);
      }

      const s = new xmldom.XMLSerializer();
      return writeFile(filePath, s.serializeToString(parsed.doc));
    })
    .then(() => {
      console.log(`Wrote sanitized SVG to ${filePath}`);
    });
}

function parseFilePath(filePath) {
  const str = path.basename(filePath, '.svg');
  const splitted = str.split('-');
  if (splitted.length !== 3) {
    throw new Error(`Unexpected amount of splits: ${splitted.length} in string "${str}"`);
  }

  const parsed = {
    style: splitted[0],
    size: splitted[1],
    orientation: splitted[2],
  };
  if (!_.includes(['landscape', 'portrait'], parsed.orientation)) {
    throw new Error(`Unexpected orientation in file path: ${parsed.orientation}`);
  }

  return parsed;
}

function svgDocToString(svgDoc) {
  const s = new xmldom.XMLSerializer();
  return s.serializeToString(svgDoc);
}

function sanitizeSvgElements(svgDoc) {
  const header = svgDoc.getElementById('header');
  if (!header) {
    throw new Error('#header not found!')
  }
  sanitizeText(header);

  const smallHeader = svgDoc.getElementById('small-header');
  if (!smallHeader) {
    console.warn('Warning: #small-header not found!');
  } else {
    sanitizeText(smallHeader);
  }

  const text = svgDoc.getElementById('text');
  if (!text) {
    console.warn('Warning: #text not found!');
  } else {
    sanitizeText(text);
  }

  const hideThis = svgDoc.getElementById('hide-this');
  if (hideThis) {
    console.log('Removing node #hide-this');
    removeNode(hideThis);
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

function readFile(filePath) {
  return fs.readFileAsync(filePath, { encoding: 'utf8' });
}

function writeFile(filePath, content) {
  return fs.writeFileAsync(filePath, content, { encoding: 'utf8' });
}

function getDimensions(node) {
  return {
    width: parseInt(node.getAttribute('width'), 10),
    height: parseInt(node.getAttribute('height'), 10),
  };
}

function sanitizeText(textNode) {
  const tspanList = textNode.getElementsByTagName('tspan');

  if (tspanList.length < 1) {
    throw new Error(`Zero tspan elements found: ${tspanList.length}`);
  }

  if (tspanList.length > 1) {
    console.log(`Found more than 1 tspan elements in \n${textNode}`);
  }
  while (tspanList.length > 1) {
    const lastItem = tspanList.item(tspanList.length - 1);
    removeNode(lastItem);
    console.log(`Removed item from tspanList, textContent: ${lastItem.textContent}`);
  }
}

function removeNode(node) {
  node.parentNode.removeChild(node);
}

// Returns expected pixel dimensions for certain size, when
// we are printing at certain `PRINT_DPI` resolution.
function parseSizeToPixelDimensions(size, orientation) {
  if (!_.isString(size) || !size.match(/[0-9]+x[0-9]+(cm|in)/)) {
    throw new Error(`Size should match /[0-9]+x[0-9]+(cm|in)/, size: ${size}`);
  }

  const unit = size.slice(-2);
  const dimensionString = size.slice(0, -2);
  const splitted = dimensionString.split('x');
  const width = parseInt(splitted[0], 10);
  const height = parseInt(splitted[1], 10);
  const widthInch = unit === 'cm' ? cmToInch(width) : width;
  const heightInch = unit === 'cm' ? cmToInch(height) : height;

  return resolveOrientation({
    width: Math.round(widthInch * PRINT_DPI, 0),
    height: Math.round(heightInch * PRINT_DPI, 0),
  }, orientation);
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

main();
