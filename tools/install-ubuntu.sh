#!/bin/bash
# Copied from: https://github.com/mapbox/mapbox-gl-native/blob/f964e40e7e9220d08751d8607af61ac5a7c0794c/scripts/travis_setup.sh

sudo apt-get install xvfb xfonts-100dpi xfonts-75dpi \
  xfonts-scalable xfonts-cyrillic gdb clang-3.8 g++-4.9 gcc-4.9 \
  gcc-5 g++-5 \
  libstdc++-4.9-dev libstdc++6 libstdc++-5-dev libllvm3.8 \
  xutils-dev libxxf86vm-dev qt-sdk libcurl4-openssl-dev \
  x11proto-xf86vidmode-dev mesa-utils \
  libgles2-mesa-dev libgbm-dev \
  libxrandr-dev libxcursor-dev libxinerama-dev \
  -y

CXX=clang++-3.8
CC=clang-3.8
HEADLESS=osmesa
WITH_OSMESA=1
${CXX} --version

sudo cp ./tools/init-xvfb.sh /etc/init.d/xvfb
sudo update-rc.d xvfb defaults
sudo /etc/init.d/xvfb start
export DISPLAY=:1
sudo sh -c "echo 'export DISPLAY=\":1\"' >> /etc/environment"

cd $HOME
git clone https://github.com/mapbox/mapbox-gl-native.git
cd mapbox-gl-native
# There is a rendering bug in the latest master which ignores
# latitude coordinate, go back to the version which doesn't
# have this issue
git checkout 16def0311745c9887f47f1ba9b2c3f28878b8ab5

git submodule update --init .mason
# Ensure mason is on the PATH
export PATH="`pwd`/.mason:${PATH}" MASON_DIR="`pwd`/.mason"
mason install mesa 13.0.0
export LD_LIBRARY_PATH="`mason prefix mesa 13.0.0`/lib:${LD_LIBRARY_PATH:-}"

wget -qO- https://raw.githubusercontent.com/creationix/nvm/v0.31.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm
source ~/.bashrc

nvm install 4
nvm use 4
make node
make node-test
