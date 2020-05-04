const BPromise = require('bluebird');
const _ = require('lodash');
const glob = require('glob');
const path = require('path');
const fs = BPromise.promisifyAll(require('fs'));
const download = require('download');
const sharp = require('sharp');
const xmldom = require('xmldom');

const IMAGES_BASE_URL = process.env.IMAGES_BASE_URL || 'https://alvarcarto-poster-assets.s3-eu-west-1.amazonaws.com';
const FORCE_DOWNLOAD = process.env.FORCE_DOWNLOAD === 'true';
const SKIP_DOWNLOAD = process.env.SKIP_DOWNLOAD === 'true';

const NODE_TYPE_ELEMENT = 1;
const ONE_CM_IN_INCH = 0.393700787;
const PRINT_DPI = 300;

const DIST_DIR = path.join(__dirname, '../posters/dist');

const SIZES_IN_INCHES = {
  A6: { width: 4.1, height: 5.8 },
  A5: { width: 5.8, height: 8.3 },
  A4: { width: 8.3, height: 11.7 },
  A3: { width: 11.7, height: 16.5 },
};

function main() {
  const customFilePaths = glob.sync(path.join(__dirname, '../posters/custom') + '/*');
  const filePaths = glob.sync(path.join(__dirname, '../posters') + '/*').concat(customFilePaths);

  console.log(`Found ${filePaths.length} posters, validating and sanitizing .. `);

  BPromise.each(filePaths, (filePath) => {
    if (_.includes(['dist', 'custom'], path.basename(filePath))) {
      return BPromise.resolve();
    }

    if (_.endsWith(filePath, '.json')) {
      return BPromise.resolve();
    }

    if (!_.endsWith(filePath, '.svg')) {
      throw new Error(`Poster file with incorrect file format found: ${filePath}`);
    }

    console.log(`\nProcessing ${filePath} ..`);
    return _transformPoster(filePath);
  })
    .catch((err) => {
      throw err;
    });
}

function _transformPoster(filePath) {
  const fileMeta = parseFilePath(filePath);

  return readFile(filePath)
    .then((svgString) => {
      const parsed = parsePosterSvg(svgString);
      if (!hasOnlyServerOrClientElements(parsed.doc, parsed.svg)) {
        return transformAndSave(parsed, fileMeta, filePath);
      }

      console.log('Found only-server or only-client attributes, splitting ..');
      const baseFilePath = path.join(path.dirname(filePath), path.basename(filePath, '.svg'));

      // Parse again to get new dom trees, which are modified in-place
      const clientParsed = parsePosterSvg(svgString);
      removeNodesWhereIdContains(clientParsed.doc, clientParsed.svg, 'only-server');

      const serverParsed = parsePosterSvg(svgString);
      removeNodesWhereIdContains(serverParsed.doc, serverParsed.svg, 'only-client');


      return transformAndSave(clientParsed, fileMeta, filePath)
        .then(() => transformAndSave(serverParsed, fileMeta, `${baseFilePath}-server.svg`));
    });
}

function parseFilePath(filePath) {
  const str = path.basename(filePath, '.svg');
  const splitted = str.split('-');

  if (_.includes(filePath, 'custom/')) {
    return {
      style: splitted[0],
      custom: true,
    };
  }

  if (splitted.length !== 3) {
    throw new Error(`Unexpected amount of splits: ${splitted.length} in string "${str}"`);
  }

  const parsed = {
    style: splitted[0],
    size: splitted[1],
    orientation: splitted[2],
    custom: false,
  };
  if (!_.includes(['landscape', 'portrait'], parsed.orientation)) {
    throw new Error(`Unexpected orientation in file path: ${parsed.orientation}`);
  }

  return parsed;
}

function transformAndSave(parsed, fileMeta, filePath) {
  const isCustom = _.includes(filePath, 'custom/');
  const newFilePath = isCustom
    ? path.join(DIST_DIR, 'custom/', path.basename(filePath))
    : path.join(DIST_DIR, path.basename(filePath));

  return transformSvg(parsed)
    .then(() => {
      if (!isCustom) {
        const { size, orientation } = fileMeta;
        const expectedDimensions = parseSizeToPixelDimensions(size, orientation);
        const svgDimensions = getDimensions(parsed.svg);
        const expected = `${expectedDimensions.width}x${expectedDimensions.height}`;
        const actual = `${svgDimensions.width}x${svgDimensions.height}`;
        if (expected !== actual) {
          throw new Error(`SVG has incorrect dimensions: ${actual}, expected: ${expected}`);
        }
      }

      return writeFile(newFilePath, svgDocToString(parsed.doc));
    })
    .then(() => {
      console.log(`Wrote sanitized SVG to ${newFilePath}`);
    });
}

function transformSvg(parsed) {
  sanitizeSvgElements(parsed.doc);
  centerElements(parsed.doc, parsed.svg);

  return BPromise.resolve()
    .tap(() => {
      if (SKIP_DOWNLOAD) {
        console.log('SKIP_DOWNLOAD=true, skipping download ..');
        console.log('\n\n--- WARNING!! This will leave server versions incomplete! ---\n\n');
        return BPromise.resolve();
      }

      return replaceAndDownloadImages(parsed.doc, parsed.svg);
    });
}

function svgDocToString(svgDoc) {
  const s = new xmldom.XMLSerializer();
  return s.serializeToString(svgDoc);
}

function sanitizeSvgElements(svgDoc) {
  const header = svgDoc.getElementById('header');
  if (!header) {
    throw new Error('#header not found!');
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

function removeNodesWhereIdContains(doc, startNode, str) {
  const foundNodes = [];

  traverse(doc, startNode, (node) => {
    const nodeId = getNodeId(node);

    if (_.includes(nodeId, str)) {
      foundNodes.push(node);
    }
  });

  _.forEach(foundNodes, (node) => {
    try {
      console.log(`Removing node ${getNodeId(node)} ..`);
      removeNode(node);
    } catch (e) {
      throw e;
    }
  });
}

function hasOnlyServerOrClientElements(doc, startNode) {
  let hasAny = false;

  traverse(doc, startNode, (node) => {
    const nodeId = getNodeId(node);

    if (_.includes(nodeId, 'only-server') || _.includes(nodeId, 'only-client')) {
      hasAny = true;
    }
  });

  return hasAny;
}

function centerElements(doc, startNode) {
  traverse(doc, startNode, (node) => {
    const nodeId = getNodeId(node);

    if (nodeId === 'center') {
      const el = doc.getElementById(nodeId);
      console.log(`Setting text-anchor="middle" for element #${el.getAttribute('id')}`);
      el.setAttribute('text-anchor', 'middle');
    }
  });
}

function replaceAndDownloadImages(doc, startNode) {
  const imageNodes = [];

  traverse(doc, startNode, (node) => {
    const nodeId = getNodeId(node);

    if (_.includes(nodeId, 'replace-with-image')) {
      imageNodes.push(node);
    }
  });

  return BPromise.map(imageNodes, (node) => {
    const nodeId = getNodeId(node);
    const imageName = nodeId.split('replace-with-image-')[1];
    if (!imageName) {
      throw new Error(`Couldn't find image name from: ${nodeId}`);
    }

    return downloadImage(imageName)
      .then(() => replaceRectWithImage(doc, node, imageName));
  }, { concurrency: 1 });
}

function downloadImage(imageName) {
  const imagesDir = path.join(DIST_DIR, 'images');
  const exists = fs.existsSync(path.join(imagesDir, imageName));
  if (exists && !FORCE_DOWNLOAD) {
    console.log(`Image ${imageName} exists, skipping download .. `);
    return BPromise.resolve();
  }

  const imageUrl = `${IMAGES_BASE_URL}/${imageName}`;
  console.log(`Downloading image ${imageUrl} ..`);
  return BPromise.resolve(download(imageUrl, imagesDir))
    .catch((err) => {
      console.log(`Couldn't download image ${imageUrl}`);
      throw err;
    });
}

async function replaceRectWithImage(doc, node, imageName) {
  const image = sharp(path.join(DIST_DIR, 'images/', imageName));
  const meta = await image.metadata();
  const imageData = await image.png().toBuffer();

  const expected = `${node.getAttribute('width')}x${node.getAttribute('height')}`;
  const actual = `${meta.width}x${meta.height}`;
  if (expected !== actual) {
    throw new Error(`Image ${imageName} has incorrect dimensions: ${actual}, expected: ${expected}`);
  }

  const imageEl = doc.createElementNS('http://www.w3.org/2000/svg', 'image');
  imageEl.setAttribute('x', node.getAttribute('x'));
  imageEl.setAttribute('y', node.getAttribute('y'));
  imageEl.setAttribute('width', node.getAttribute('width'));
  imageEl.setAttribute('height', node.getAttribute('height'));
  imageEl.setAttribute('xlink:href', `data:image/png;base64,${imageData.toString('base64')}`);

  const parent = node.parentNode;
  parent.replaceChild(imageEl, node);
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

function getNodeId(node) {
  if (node.nodeType !== NODE_TYPE_ELEMENT || !node.hasAttributes()) {
    return null;
  }

  for (let i = 0; i < node.attributes.length; ++i) {
    const attr = node.attributes[i];
    if (attr.name === 'id') {
      return attr.value;
    }
  }

  return null;
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
  if (_.has(SIZES_IN_INCHES, size)) {
    const { width, height } = SIZES_IN_INCHES[size];

    return resolveOrientation({
      width: Math.round(width * PRINT_DPI, 0),
      height: Math.round(height * PRINT_DPI, 0),
    }, orientation);
  }

  if (!_.isString(size) || !size.match(/[0-9]+x[0-9]+(cm|inch)/)) {
    throw new Error(`Size should match /[0-9]+x[0-9]+(cm|inch)/, size: ${size}`);
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
