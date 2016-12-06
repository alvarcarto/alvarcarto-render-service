#!/bin/bash

curl -o ./lib/mapbox-flow.js https://raw.githubusercontent.com/mapbox/mapbox-gl-js/17247006c818626f779ffe616062e3a80dc25c7d/js/util/mapbox.js
./node_modules/.bin/flow-remove-types ./lib/mapbox-flow.js > ./src/mapbox-util.js

echo "Remember to implement needed changes to ./src/mapbox-util.js!"