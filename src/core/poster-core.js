const fs = require('fs');
const BPromise = require('bluebird');
const TextToSVG = require('text-to-svg');
const sharp = require('sharp');
const logger = require('../util/logger')(__filename);

const textToSVG = TextToSVG.loadSync();

function addLabels(poster) {
  logger.info('Adding labels');

  const svgOptions = {
    x: 0,
    y: 0,
    fontSize: 160,
    anchor: 'left top',
    attributes: { fill: 'black', stroke: 'black' },
  };
  //const svg = textToSVG.getSVG('hello', svgOptions);
  const svg = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    width="800"
    height="400"
  >
    <text font-family="Raleway" font-size="140" x="400" y="200" text-anchor="middle">
      Test
      whats
    </text>
  </svg>
  `;
  fs.writeFileSync('text.svg', svg, {encoding: 'utf8'});
  console.log(textToSVG.getMetrics('hello', svgOptions))

  return poster
    .overlayWith(new Buffer(svg, 'utf8'), { gravity: 'south', bottom: 100 })
    .png()
    .toBuffer();
}

module.exports = {
  addLabels,
};
