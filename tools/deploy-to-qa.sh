#!/bin/bash

set -e
set -x

npm run build

ssh alvar@$SERVER_HOST "bash -l -c \"rm -r ~/alvarcarto-render-service/dist/\""
scp -r dist alvar@$SERVER_HOST:~/alvarcarto-render-service/
scp -r posters/* alvar@$SERVER_HOST:~/alvarcarto-render-service/posters

ssh alvar@$SERVER_HOST "bash -l -c 'PATH=$PATH:/home/alvar/.nvm/versions/node/v6.9.4/bin pm2 restart all'"
