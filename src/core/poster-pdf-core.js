const BPromise = require('bluebird');
const _ = require('lodash');
const path = require('path');
const fs = BPromise.promisifyAll(require('fs'));
const sharp = require('sharp');
const convert = require('convert-units');
const fontkit = require('fontkit');
const PDFLib = require('pdf-lib');
const PDFLibFontkit = require('@pdf-lib/fontkit');
const PDFKitDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const streamToPromise = require('stream-to-promise');
const mapCore = require('./map-core');
const {
  readPosterFile,
  getPosterDimensions,
  parseSvgString,
  transformPosterSvgDoc,
  svgDocToString,
  getSvgElement,
  parseSize,
  posterMetaQuery,
  getTempPath,
  getSvgDocFonts,
  matchFont,
  getFirstFontFamily,
  calculatePadding,
} = require('../util/poster');
const config = require('../config');
const logger = require('../util/logger')(__filename);

BPromise.promisifyAll(fontkit);
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

function normalizeDimensions(opts) {
  const parsedSize = parseSize(opts.size);
  const widthStr = `${parsedSize.width}${parsedSize.unit}`;
  const heightStr = `${parsedSize.height}${parsedSize.unit}`;

  const parsedWidth = parseUnit(widthStr);
  const parsedHeight = parseUnit(heightStr);
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

// Original function here: https://github.com/alafr/SVG-to-PDFKit/blob/15ab82dff389bb990dd4e9493ce8531cf9eb6298/source.js#L2446
function fontCallback(doc, fontPsMapping, familyAttr, bold, italic, fontOptions) {
  const family = getFirstFontFamily(familyAttr);
  if (bold && italic && _.has(doc._registeredFonts, `${family}-BoldItalic`)) {
    logger.debug(`Found a match for font ${family} -> ${family}-BoldItalic (bold and italic styles)`);
    return family;
  }

  if (bold && _.has(doc._registeredFonts, `${family}-Bold`)) {
    logger.debug(`Found a match for font ${family} -> ${family}-Bold (bold style)`);
    return family;
  }

  if (italic && _.has(doc._registeredFonts, `${family}-Italic`)) {
    logger.debug(`Found a match for font ${family} -> ${family}-Italic (italic style)`);
    return family;
  }

  if (_.has(doc._registeredFonts, family)) {
    logger.debug(`Found a match for font ${family} -> ${family}`);
    return family;
  }

  const psName = fontPsMapping[family];
  if (_.has(doc._registeredFonts, psName)) {
    logger.info(`Found a match for font ${family} -> ${psName}`);
    return psName;
  }

  throw new Error(`No matching font found for ${family} (${familyAttr}) in SVG -> PDF conversion`);
}

async function addPaddings(pdfPage, dims, color = PDFLib.rgb(1, 1, 1)) {
  const combos = [
    // top
    { x: 0, y: 0, width: dims.width, height: dims.padding },
    // left
    { x: 0, y: 0, width: dims.padding, height: dims.height },
    // right
    { x: dims.width - dims.padding, y: 0, width: dims.padding, height: dims.height },
    // bottom
    { x: 0, y: dims.height - dims.padding, width: dims.width, height: dims.padding },
  ];

  _.forEach(combos, (combo) => {
    pdfPage.drawRectangle({
      ...combo,
      borderWidth: 0,
      color,
    });
  });
}

async function posterSvgToPdf(svgDoc, pdfDims, fontMapping) {
  const pdf = new PDFKitDocument({ autoFirstPage: false });

  const svgNode = getSvgElement(svgDoc);
  // px values need to be changed to pt for correct size
  svgNode.setAttribute('width', `${pdfDims.width}pt`);
  svgNode.setAttribute('height', `${pdfDims.height}pt`);

  const fontPsMapping = {};
  const fonts = getSvgDocFonts(svgDoc);
  logger.info(`Found fonts from SVG: ${JSON.stringify(fonts)}`);
  await BPromise.each(fonts, async (fontName) => {
    const fontFileName = matchFont(fontName, fontMapping);
    const fontPath = path.join(config.FONT_DIR, fontFileName);

    // We're not using the postscript name for mapping in the end, but the filename
    // However this code was left here in case we need to do matching with postscript name
    // later
    const font = await fontkit.openAsync(fontPath);
    fontPsMapping[fontName] = font.postscriptName;

    logger.info(`Embedding font ${fontPath}`);
    pdf.registerFont(fontName, fontPath);
  });

  pdf.addPage({
    size: [pdfDims.width, pdfDims.height],
    layout: pdfDims.width > pdfDims.height ? 'landscape' : 'portrait',
    margin: 0,
  });

  SVGtoPDF(pdf, svgDocToString(svgDoc), 0, 0, {
    fontCallback: fontCallback.bind(fontCallback, pdf, fontPsMapping),
  });
  pdf.end();

  const pdfBuf = await streamToPromise(pdf);
  return pdfBuf;
}

async function generateVectorPdf(opts) {
  const posterSvgStr = await readPosterFile(_.extend({}, opts, { clientVersion: true }));
  const posterDims = await getPosterDimensions(opts);

  assertAspectRatio(posterDims, opts);

  const parsedPoster = parseSvgString(posterSvgStr);
  const posterDoc = transformPosterSvgDoc(parsedPoster.doc, opts);

  const targetDims = normalizeDimensions(opts);
  const pdfDims = calculateDocDimensions(targetDims);
  const pdfDimToPosterDimRatio = (pdfDims.width / posterDims.width);
  const mapOpts = _.merge({}, opts, {
    width: posterDims.width,
    height: posterDims.height,
    format: 'pdf',
  });
  const mapPdfBuf = await mapCore.render(_.omit(mapOpts, _.isNil));
  const pdfDoc = await PDFLibDocument.create();
  pdfDoc.registerFontkit(PDFLibFontkit);
  pdfDoc.setTitle(`Map poster ${opts.size}`);
  pdfDoc.setSubject(posterMetaQuery(opts));
  pdfDoc.setAuthor('Alvar Carto (alvarcarto.com). Map data by OpenStreetMap contributors.');
  pdfDoc.setCreator('pdf-lib (https://github.com/Hopding/pdf-lib)');
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());

  const mapPdfBytes = await PDFLibDocument.load(mapPdfBuf);
  const mapElement = await pdfDoc.embedPage(mapPdfBytes.getPages()[0]);
  const mapDims = mapElement.scale(pdfDimToPosterDimRatio);
  const page = pdfDoc.addPage([pdfDims.width, pdfDims.height]);
  page.drawPage(mapElement, {
    ...mapDims,
    x: 0,
    y: 0,
  });

  if (!opts.labelsEnabled) {
    addPaddings(page, _.extend({}, pdfDims, {
      padding: calculatePadding(pdfDims),
    }));
  } else {
    const overlayPdfBuf = await posterSvgToPdf(posterDoc, pdfDims, opts.fontMapping);
    if (config.SAVE_TEMP_FILES) {
      const tmpPath = getTempPath(`${opts.uuid}-svgtopdf.pdf`);
      await fs.writeFileAsync(tmpPath, overlayPdfBuf, { encoding: null });
    }

    const overlayPdfBytes = await PDFLibDocument.load(overlayPdfBuf);
    const [overlayElement] = await pdfDoc.embedPdf(overlayPdfBytes);
    // const overlayDims = overlayElement.scale(pdfDimToPosterDimRatio);
    page.drawPage(overlayElement, {
      x: 0,
      y: 0,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return {
    // Uint8Array to Buffer
    data: Buffer.from(pdfBytes.buffer, 'binary'),
    meta: {
      posterWidth: posterDims.width,
      posterHeight: posterDims.height,
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

  const pdf = await generatePdfWithEmbeddedImage(posterPng, opts);

  // Target dimensions are in inches, the dpi is simply pixels / inches
  logger.info(`Generated PDF with embedded PNG with dpi ${pdf.meta.imageWidth / pdf.meta.targetWidthInch}`);
  logger.info('Meta:', pdf.meta);
  return pdf.data;
}

async function renderVector(opts) {
  const pdf = await generateVectorPdf(opts);

  logger.info(`Generated vector PDF for target size ${opts.size}`);
  logger.info('Meta:', pdf.meta);
  return pdf.data;
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
