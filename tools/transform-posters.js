const BPromise = require('bluebird');
const _ = require('lodash');
const glob = require('glob');
const path = require('path');
const fs = BPromise.promisifyAll(require('fs'));
const download = require('download');
const sharp = require('sharp');
const {
  parseSvgString,
  getNodeDimensions,
  parseSizeToPixelDimensions,
  svgDocToString,
  pickNotoVariation,
  NODE_TYPE_ELEMENT,
  traverse,
} = require('../src/util/poster');

const IMAGES_BASE_URL = process.env.IMAGES_BASE_URL || 'https://alvarcarto-poster-assets.s3-eu-west-1.amazonaws.com';
const FORCE_DOWNLOAD = process.env.FORCE_DOWNLOAD === 'true';
const SKIP_DOWNLOAD = process.env.SKIP_DOWNLOAD === 'true';

const DIST_DIR = path.join(__dirname, '../posters/dist');

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
      const parsed = parseSvgString(svgString);
      if (!hasOnlyServerOrClientElements(parsed.doc, parsed.svg)) {
        return transformAndSave(parsed, fileMeta, filePath);
      }

      console.log('Found only-server or only-client attributes, splitting ..');
      const baseFilePath = path.join(path.dirname(filePath), path.basename(filePath, '.svg'));

      // Parse again to get new dom trees, which are modified in-place
      const clientParsed = parseSvgString(svgString);
      removeNodesWhereIdContains(clientParsed.doc, clientParsed.svg, 'only-server');

      const serverParsed = parseSvgString(svgString);
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
        const svgDimensions = getNodeDimensions(parsed.svg);
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
  parsed.svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  sanitizeSvgElements(parsed.doc);
  centerElements(parsed.doc, parsed.svg);
  fontFamiliesInQuotes(parsed.doc, parsed.svg);
  addFallbackFonts(parsed.doc, parsed.svg);

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

function fontFamiliesInQuotes(doc, startNode) {
  traverse(doc, startNode, (node) => {
    if (node.nodeType !== NODE_TYPE_ELEMENT || !node.hasAttributes()) {
      return;
    }

    const fontFamily = node.getAttribute('font-family');
    if (_.isString(fontFamily) && fontFamily.trim().length > 0 && fontFamily.trim()[0] !== '\'') {
      const cleaned = _.trimEnd(_.trimStart(fontFamily, '\'"'), '\'"');
      console.log(`Setting font-family in single quotes for element #${getNodeId(node)}`);
      node.setAttribute('font-family', `'${cleaned}'`);
    }
  });
}

function addFallbackFonts(doc, startNode) {
  traverse(doc, startNode, (node) => {
    if (node.nodeType !== NODE_TYPE_ELEMENT || !node.hasAttributes()) {
      return;
    }

    const fontFamily = node.getAttribute('font-family');
    if (_.isString(fontFamily) && fontFamily.trim().length > 0) {
      const trimmed = fontFamily.trim();
      console.log(`Adding fallback font-family for element #${getNodeId(node)}`);
      if (trimmed[0] !== '\'' || trimmed[trimmed.length - 1] !== '\'') {
        throw new Error(`Found a font-family definition without single quotes: ${fontFamily}`);
      }

      const cleaned = _.trimEnd(_.trimStart(trimmed, '\'"'), '\'"');
      const notoFallback = pickNotoVariation(cleaned);
      const newAttr = `'${cleaned},${notoFallback}'`;
      node.setAttribute('font-family', newAttr);
      console.log(`Font-family set as ${newAttr} for element #${getNodeId(node)}`);
    }
  });
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
  const imageAbsPath = path.join(DIST_DIR, 'images/', imageName);
  const image = sharp(imageAbsPath, { limitInputPixels: false });
  const meta = await image.metadata();

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
  // https://stackoverflow.com/questions/2961624/rsvg-doesnt-render-linked-images
  imageEl.setAttribute('xlink:href', `file://${imageAbsPath}`);

  const parent = node.parentNode;
  parent.replaceChild(imageEl, node);
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

function readFile(filePath) {
  return fs.readFileAsync(filePath, { encoding: 'utf8' });
}

function writeFile(filePath, content) {
  return fs.writeFileAsync(filePath, content, { encoding: 'utf8' });
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

main();
