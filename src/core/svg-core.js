const TextToSVG = require('text-to-svg');
const textToSVG = TextToSVG.loadSync();

module.exports.whiteGradient = (width, height) => `<svg
  version="1.1"
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  x="0px"
  y="0px"
  viewBox="0 0 ${width} ${height}"
  style="enable-background:new 0 0 ${width} ${height};"
>
  <linearGradient
    id="gradient"
    gradientUnits="userSpaceOnUse"
    x1="0"
    y1="0"
    x2="0"
    y2="${height}"
  >
    <stop offset="0" style="stop-color: #FFFFFF; stop-opacity: 0"/>
    <stop offset="0.5" style="stop-color: #FFFFFF"/>
  </linearGradient>
  <rect fill="url(#gradient)" class="rect" width="${width}" height="${height}"/>
</svg>
`;


module.exports.labels = (opts) => {
  const svgOptions = {
    x: 0,
    y: 0,
    fontSize: 160,
    anchor: 'left top',
    attributes: { fill: 'black', stroke: 'black' },
  };

  return `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      width="${opts.width}"
      height="${opts.height}"
    >
      <text
        letter-spacing="0.2em"
        font-weight="700"
        font-family="Proxima Nova"
        font-size="160"
        x="${opts.width / 2}"
        y="${opts.height / 2}"
        text-anchor="middle"
      >
        ${opts.header}
      </text>
      <text
        letter-spacing="0.2em"
        font-weight="700"
        font-family="Proxima Nova"
        font-size="100"
        x="${opts.width / 2}"
        y="${opts.height / 2 + 160}"
        text-anchor="middle"
      >
        ${opts.header}
      </text>
    </svg>
  `;
};
