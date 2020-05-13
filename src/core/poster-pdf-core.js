const BPromise = require('bluebird');
const _ = require('lodash');
const fs = BPromise.promisifyAll(require('fs'));
const sharp = require('sharp');
const convert = require('convert-units');
const PDFLib = require('pdf-lib');
const PDFKitDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const streamToPromise = require('stream-to-promise');
const mapCore = require('./map-core');
const {
  readPosterFile,
  getPosterDimensions,
  parseSvgString,
  transformPosterSvgDoc,
  getNodeDimensions,
  svgDocToString,
  getSvgElement,
  parseSize,
  getTempPath,
} = require('../util/poster');
const config = require('../config');
const logger = require('../util/logger')(__filename);

const PDFLibDocument = PDFLib.PDFDocument;

function parseUnit(str) {
  const trimmed = str.trim();
  const parsedFloat = parseFloat(trimmed);
  let unit;
  if (_.endsWith(trimmed, 'mm')) {
    unit = 'mm';
  } else if (_.endsWith(trimmed, 'cm')) {
    unit = 'cm';
  } else if (_.endsWith(trimmed, 'm')) {
    unit = 'm';
  } else if (_.endsWith(trimmed, 'inch') || _.endsWith(trimmed, 'in')) {
    unit = 'in';
  }
  return {
    unit,
    value: parsedFloat,
  };
}

function normalizeDimensions(dim) {
  const parsedWidth = parseUnit(dim.width);
  const parsedHeight = parseUnit(dim.height);
  return {
    width: convert(parsedWidth.value).from(parsedWidth.unit).to('in'),
    height: convert(parsedHeight.value).from(parsedHeight.unit).to('in'),
  };
}

function assertAspectRatio(pixelDims, opts) {
  const targetDims = normalizeDimensions(opts);
  const ratioPixel = pixelDims.width / pixelDims.height;
  const ratioTarget = targetDims.width / targetDims.height;
  const isCloseEnough = Math.abs(ratioPixel - ratioTarget) < 0.001;
  if (!isCloseEnough) {
    const msg = `${targetDims.width}in (${opts.width}) / ${targetDims.height}in (${opts.height}) = ${ratioTarget} does not equal to ${pixelDims.width}px / ${pixelDims.height}px = ${ratioPixel}`;
    throw new Error(`Incorrect aspect ratio for target dimensions: ${msg}`);
  }
}

// "In PDF land, 72 points (per inch ...) is the standard when looking at things like page sizes.
// For example, an A4 portrait page is 595x842 points (2480 pixels x 3508 pixels at 300 DPI)
// So, instead of increasing the size of everything, I decreased it in proportion to
// the difference between the given dpi of the scanned image and 72."
// Source: https://github.com/foliojs/pdfkit/issues/415
function calculateDocDimensions(targetDims) {
  return {
    width: targetDims.width * 72,
    height: targetDims.height * 72,
  };
}

async function generatePdfWithEmbeddedImage(input, opts = {}) {
  const targetDims = normalizeDimensions(opts);
  const sharpIm = sharp(input, { limitInputPixels: false });
  const meta = await sharpIm.metadata();

  assertAspectRatio(meta, opts);

  const pdfDoc = await PDFLibDocument.create();
  const pngBuf = await sharpIm.png().toBuffer();
  const pngImage = await pdfDoc.embedPng(pngBuf);

  const docDims = calculateDocDimensions(targetDims);
  const page = pdfDoc.addPage([docDims.width, docDims.height]);
  page.drawImage(pngImage, {
    x: 0,
    y: 0,
    width: docDims.width,
    height: docDims.height,
  });

  // Serialize the document to bytes (a Uint8Array)
  const pdfBytes = await pdfDoc.save();
  return {
    // Uint8Array to Buffer
    data: Buffer.from(pdfBytes.buffer, 'binary'),
    meta: {
      imageWidth: meta.width,
      imageHeight: meta.height,
      targetWidthInch: targetDims.width,
      targetHeightInch: targetDims.height,
    },
  };
}

async function renderPngEmbedded(opts) {
  const pngOpts = _.extend({}, opts, { format: 'png' });
  const posterPng = await opts.originalRender(pngOpts);

  if (config.SAVE_TEMP_FILES) {
    const tmpPngPath = getTempPath(`${opts.uuid}-embedded-poster.png`);
    await fs.writeFileAsync(tmpPngPath, posterPng, { encoding: null });
  }

  const parsedSize = parseSize(opts.size);
  const pdf = await generatePdfWithEmbeddedImage(posterPng, {
    width: `${parsedSize.width}${parsedSize.unit}`,
    height: `${parsedSize.height}${parsedSize.unit}`,
  });

  // Target dimensions are in inches, the dpi is simply pixels / inches
  logger.info(`Generated PDF with dpi ${pdf.meta.imageWidth / pdf.meta.targetWidthInch}`);
  logger.info('Meta:', pdf.meta);
  return pdf.data;
}

async function posterSvgToPdf(svgDoc) {
  const pdf = new PDFKitDocument({ autoFirstPage: false });

  const svgNode = getSvgElement(svgDoc);
  const nodeDims = getNodeDimensions(svgNode);
  pdf.addPage({
    size: [nodeDims.width, nodeDims.height],
    margin: 0,
  });

  SVGtoPDF(pdf, svgDocToString(svgDoc), 0, 0);
  pdf.end();

  const pdfBuf = await streamToPromise(pdf);
  return pdfBuf;
}

async function renderVector(opts) {
  const posterSvgStr = await readPosterFile(_.extend({}, opts, { clientVersion: true }));
  const posterDims = await getPosterDimensions(opts);

  const parsedPoster = parseSvgString(posterSvgStr);
  const posterDoc = transformPosterSvgDoc(parsedPoster.doc, opts);

  const mapOpts = _.merge({}, opts, {
    width: posterDims.width,
    height: posterDims.height,
    format: 'pdf',
  });
  const mapPdfBuf = await mapCore.render(_.omit(mapOpts, _.isNil));

  if (!opts.labelsEnabled) {
    throw new Error(`Not implemented`)
    // addPaddings(posterDoc, posterDims);
  }

  const pdfDims = {
    width: posterDims.width,
    height: posterDims.height,
  };
  const pdfDoc = await PDFLibDocument.create();
  const mapPdfBytes = await PDFLibDocument.load(mapPdfBuf);
  const fullPage = {
    left: 0,
    bottom: 0,
    right: pdfDims.width,
    top: pdfDims.height,
  };
  const mapElement = await pdfDoc.embedPage(mapPdfBytes.getPages()[0], fullPage);
  console.log('mapelement', mapElement.size());

  const overlayPdfBuf = await posterSvgToPdf(posterDoc);
  const overlayPdfBytes = await PDFLibDocument.load(overlayPdfBuf);
  const overlayElement = await pdfDoc.embedPage(overlayPdfBytes.getPages()[0], fullPage);
  console.log('overlayelement', overlayElement.size());

  // TODO: Set page width so that it'll match physical dimensions
  const page = pdfDoc.addPage([pdfDims.width, pdfDims.height]);
  page.drawPage(mapElement, {
    x: 0,
    y: 0,
    width: pdfDims.width,
    height: pdfDims.height,
  });
  page.drawPage(overlayElement, {
    x: 0,
    y: 0,
    width: pdfDims.width,
    height: pdfDims.height,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes.buffer, 'binary');
}

async function render(_opts) {
  const opts = _.omit(_opts, ['resizeToWidth', 'resizeToHeight']);

  if (opts.embedPng) {
    return await renderPngEmbedded(opts);
  }

  return await renderVector(opts);
}

module.exports = {
  render,
};
