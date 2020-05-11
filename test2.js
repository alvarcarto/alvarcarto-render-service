const _ = require('lodash');
const fs = require('fs');
const sharp = require('sharp');
const convert = require('convert-units');
const { PDFDocument } = require('pdf-lib');

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
function calculateDocDimensions(pixelDims, targetDims) {
  return {
    width: targetDims.width * 72,
    height: targetDims.height * 72,
  };
}

async function generatePdf(input, opts = {}) {
  const targetDims = normalizeDimensions(opts);
  const image = sharp(input, { limitInputPixels: false });
  const meta = await image.metadata();

  assertAspectRatio(meta, opts);

  // Create a new PDFDocument
  const pdfDoc = await PDFDocument.create();
  const pngBuf = await image.png().toBuffer();
  const pngImage = await pdfDoc.embedPng(pngBuf);

  const docDims = calculateDocDimensions(meta, targetDims);
  const page = pdfDoc.addPage([docDims.width, docDims.height]);
  page.drawImage(pngImage, {
    x: 0,
    y: 0,
    width: docDims.width,
    height: docDims.height,
  });

  // Serialize the PDFDocument to bytes (a Uint8Array)
  const pdfBytes = await pdfDoc.save();
  return {
    data: pdfBytes,
    meta: {
      imageWidth: meta.width,
      imageHeight: meta.height,
      targetWidthInch: targetDims.width,
      targetHeightInch: targetDims.height,
    },
  };
}

async function main() {
  const opts = {
    width: '30cm',
    height: '40cm',
  };

  const pdf = await generatePdf('image.png', opts);
  fs.writeFileSync('test.pdf', pdf.data, { encoding: null });

  // Target dimensions are in inches, the dpi is simply pixels / inches
  console.log(`Printed PDF with dpi ${pdf.meta.imageWidth / pdf.meta.targetWidthInch}`);
  console.log('Meta:', pdf.meta);
}

main();
