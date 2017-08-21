#!/bin/bash

set -e
set -x

echo -e "Optimizing ./posters/*.svg with svgo ..\n"
./node_modules/.bin/svgo --config=tools/svgo.yml -f ./posters

echo -e "Optimizing ./posters/custom/*.svg with svgo ..\n"
./node_modules/.bin/svgo --config=tools/svgo.yml -f ./posters/custom

echo -e "Removing old posters in posters/dist ..\n"
rm -f ./posters/dist/*.svg
rm -f ./posters/dist/custom/*.svg
# Commented by default because it's faster to not download images on each
# start
# rm -f ./posters/dist/images/*
rm -f ./*.png

echo -e "Copying custom .json files ..\n"
cp ./posters/custom/*.json ./posters/dist/custom/

echo -e "Running custom sanitize ..\n"
node tools/sanitize-posters.js

echo -e "Copying images to project root for SVG rendering .."
echo -e "This is a hack to fix SVG image links\n"
cp posters/dist/images/* .
