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

echo -e "Running custom transformation and validation for posters ..\n"
node tools/transform-posters.js
