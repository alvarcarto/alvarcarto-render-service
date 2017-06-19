#!/bin/bash

set -e
set -x

scp -r posters/* alvar@$SERVER_HOST:~/alvarcarto-render-service/posters
