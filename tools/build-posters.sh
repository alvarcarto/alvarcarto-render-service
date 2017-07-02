#!/bin/bash

set -e
set -x

echo -e "Optimizing ./posters/*.svg with svgo ..\n"
./node_modules/.bin/svgo --config=tools/svgo.yml -f ./posters

echo -e "Running custom sanitize ..\n"
node tools/sanitize-posters.js
