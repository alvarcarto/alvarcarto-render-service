#!/bin/bash

curl -o mapbox-flow.js https://raw.githubusercontent.com/mapbox/mapbox-gl-js/17247006c818626f779ffe616062e3a80dc25c7d/js/util/mapbox.js
./node_modules/.bin/flow-remove-types mapbox-flow.js > mapbox-util.js