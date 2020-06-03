# Render service

Provides an API to render Alvar Carto map posters.

This service depends on Mapnik server (https://github.com/gravitystorm/openstreetmap-carto/blob/master/INSTALL.md).
It's non-trivial to install, so it
has been automated in [this repository](https://github.com/kimmobrunfeldt/alvarcarto-map-server).

## Local docker development

To get started:

* `npm run bash` to enter bash inside docker.
* `npm install`
* Exit back to host
* `docker-compose up`

**Warning: posters are built into posters/dist, and the final poster images contain absolute system paths to referenced png images!**


## How map is created

1. Render a map with a resolution which will result to a 300DPI print
2. Apply label overlay (SVG) on top of the rendered map

  These SVG canvases should match the rendered map images pixel perfect.

  The labels in SVGs are following a certain ID convention so they can be
  dynamically replaced with a DOM parser/modifier.

3. Save the combined huge image


### Different formats

The render service supports different output formats. They are rendered differently based on the format.

#### PNG / JPG

1. Render the given map as png image with Mapnik. (or tile renderer)
2. Render the poster style SVG as png image. (transparency is needed until this point)

    We use the `-server.svg` version here to use the properly dithered pre-made gradient to avoid
    gradient banding when printing. See this issue for more: https://github.com/lovell/sharp/issues/867

3. Combine these images and possible re-encode to JPG

#### SVG

1. Render map as SVG with Mapnik.
2. Take the poster style SVG string and inject map SVG into the lowest layer of the SVG (under the overlay).

    We use the `-client.svg` version here. Beware of gradient banding when printing.
3. If render was done without labels, add a white padding on top of the map.

Correct fonts are required for the viewer. Maybe embed fonts as base64?

#### PDF with embedded PNG image

1. Render the poster as PNG exactly as mentioned in PNG / JPG method.
2. Wrap the poster into a PDF file, crafted so that the image will be 300dpi when printed.

#### PDF as vector graphic

1. Render the map as PDF with Mapnik.
2. Render the poster style SVG as PDF vector graphic (with automatic svg to pdf conversion).
3. Combine the two PDFs so that map layer is under the overlay.
3. If render was done without labels, add a white padding on top of the map.

Fonts need to be embedded in the PDF.


### Possible improvements

* SVG doesn't embed fonts
* https://www.npmjs.com/package/text-to-svg
* Font rendering in vector PDF to support texts which has glyphs from different fonts (this works with other render methods)
