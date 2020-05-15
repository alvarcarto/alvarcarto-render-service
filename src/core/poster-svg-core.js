const _ = require('lodash');
const mapCore = require('./map-core');
const {
  readPosterFile,
  getPosterDimensions,
  parseSvgString,
  transformPosterSvgDoc,
  getNodeDimensions,
  svgDocToString,
  getSvgElement,
  NODE_TYPE_ELEMENT,
} = require('../util/poster');

function assertDimensions(posterDims, mapDims) {
  const expected = `${posterDims.width}x${posterDims.height}`;
  const actual = `${mapDims.width}x${mapDims.height}`;
  if (expected !== actual) {
    throw new Error(`Map svg has incorrect dimensions: ${actual}, expected: ${expected}`);
  }
}

function assertViewbox(posterSvg, mapSvg) {
  const expected = posterSvg.getAttribute('viewBox');
  const actual = mapSvg.getAttribute('viewBox');
  if (expected !== actual) {
    throw new Error(`Map viewBox is different from poster viewBox: ${actual}, expected: ${expected}`);
  }
}

function removeAllChildNodes(posterSvg) {
  while (posterSvg.childNodes.length > 0) {
    posterSvg.removeChild(posterSvg.childNodes.item(0));
  }
}

function createNode(doc, tag, attrs) {
  const el = doc.createElementNS('http://www.w3.org/2000/svg', tag);
  _.forEach(attrs, (val, key) => {
    el.setAttribute(key, val);
  });

  return el;
}

function addPaddings(posterDoc, dims) {
  const top = createNode(posterDoc, 'rect', {
    x: 0,
    y: 0,
    width: dims.width,
    height: dims.padding,
    'stroke-width': 0,
    fill: '#ffffff',
  });

  const left = createNode(posterDoc, 'rect', {
    x: 0,
    y: 0,
    width: dims.padding,
    height: dims.height,
    'stroke-width': 0,
    fill: '#ffffff',
  });

  const right = createNode(posterDoc, 'rect', {
    x: dims.width - dims.padding,
    y: 0,
    width: dims.padding,
    height: dims.height,
    'stroke-width': 0,
    fill: '#ffffff',
  });

  const bottom = createNode(posterDoc, 'rect', {
    x: 0,
    y: dims.height - dims.padding,
    width: dims.width,
    height: dims.padding,
    'stroke-width': 0,
    fill: '#ffffff',
  });

  const svg = getSvgElement(posterDoc);
  svg.appendChild(top);
  svg.appendChild(left);
  svg.appendChild(right);
  svg.appendChild(bottom);
}

async function render(_opts) {
  const opts = _.omit(_opts, ['resizeToWidth', 'resizeToHeight']);
  const posterSvgStr = await readPosterFile(_.extend({}, opts, { clientVersion: true }));
  const posterDims = await getPosterDimensions(opts);

  const parsedPoster = parseSvgString(posterSvgStr);
  const posterDoc = transformPosterSvgDoc(parsedPoster.doc, opts);
  // Mutating posterSvg also affects the posterDoc
  const posterSvg = getSvgElement(posterDoc);

  const mapOpts = _.merge({}, opts, {
    width: posterDims.width,
    height: posterDims.height,
  });
  const mapSvgBuf = await mapCore.render(_.omit(mapOpts, _.isNil));
  const parsedMap = parseSvgString(mapSvgBuf.toString('utf8'));
  const mapSvg = parsedMap.svg;
  const mapDims = getNodeDimensions(mapSvg);

  assertDimensions(posterDims, mapDims);
  assertViewbox(posterSvg, mapSvg);

  if (!mapSvg.hasChildNodes()) {
    throw new Error('Empty map svg returned from mapnik');
  }

  const gEl = posterDoc.createElementNS('http://www.w3.org/2000/svg', 'g');
  gEl.setAttribute('id', 'map');
  const svgEl = posterDoc.importNode(mapSvg, true);
  for (let i = 0; i < svgEl.childNodes.length; i += 1) {
    const svgElNode = svgEl.childNodes.item(i);
    if (svgElNode.nodeType === NODE_TYPE_ELEMENT) {
      gEl.appendChild(svgElNode);
    }
  }

  if (!opts.labelsEnabled) {
    removeAllChildNodes(posterSvg);
    addPaddings(posterDoc, posterDims);
  }

  posterSvg.insertBefore(gEl, posterSvg.firstChild);

  return svgDocToString(posterDoc);
}

module.exports = {
  render,
};
