# Render service

Provides an API to render Alvar Carto map posters.

## Get started

* `nvm use 4` *Needs node 4*
* Make sure you have deps installed: https://github.com/mapbox/mapbox-gl-native/blob/master/INSTALL.md#2-installing-dependencies
* Install https://github.com/aheckmann/gm#getting-started
* `npm install`
* Done. Run `node src/render.js`.


## Install on Ubuntu

Locally:

```bash
scp vector-render alvar-map:~/vector-render
ssh alvar@alvar-map
```

In remote:

```bash
cd ~/vector-render
./tools/install-ubuntu.sh
```


## Rebuild ./src/mapbox-util.js

```bash
npm i
./tools/build.sh
```

Then implement needed changes to ./src/mapbox-util.js.


## How map is created



