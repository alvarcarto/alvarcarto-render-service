## Get started

* `nvm use 4` *Needs node 4*
* Make sure you have deps installed: https://github.com/mapbox/mapbox-gl-native/blob/master/INSTALL.md#2-installing-dependencies
* Install https://github.com/aheckmann/gm#getting-started
* Follow [node-canvas Install guide](https://github.com/Automattic/node-canvas)

  On 26th Jan 2017, on Ubuntu it needs:

  `sudo apt-get install libcairo2-dev libjpeg8-dev libpango1.0-dev libgif-dev build-essential g++`

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

