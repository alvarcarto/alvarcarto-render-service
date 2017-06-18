#!/bin/bash

cp -r node_modules/svgdom node_modules/svgdom-dist
babel node_modules/svgdom -d node_modules/svgdom-dist --presets es2015
rm -r node_modules/svgdom
mv node_modules/svgdom-dist node_modules/svgdom