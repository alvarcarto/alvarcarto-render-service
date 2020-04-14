# Render service

Provides an API to render Alvar Carto map posters.

This service depends on Mapnik server (https://github.com/gravitystorm/openstreetmap-carto/blob/master/INSTALL.md).
It's non-trivial to install, so it
has been automated in [this repository](https://github.com/kimmobrunfeldt/alvarcarto-map-server).

## Local docker development

To get started:

* `docker-compose run render bash`
* `nvm use 8`
* `npm install`
* `docker-compose up`


## How map is created

1. Render a map with a resolution which will result to a 300DPI print
2. Apply label overlay (SVG) on top of the rendered map

  These SVG canvases should match the rendered map images pixel perfect.

  The labels in SVGs are following a certain ID convention so they can be
  dynamically replaced with a DOM parser/modifier.

3. Save the combined huge image


