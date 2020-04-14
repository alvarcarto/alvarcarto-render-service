const fs = require('fs');
const path = require('path');
const BPromise = require('bluebird');
const _ = require('lodash');
const config = require('../config');

BPromise.promisifyAll(fs);

const AUTOGEN_SUFFIX = '-autogen';

// Warning: this function breaks if there are multiple different postgis instances .
//          It's not very future proof in any case but does the trick.
//
// The xml file contains multiple blocks where postgis connection parameters are defined as below:
//  <Parameter name="dbname"><![CDATA[osm]]></Parameter>
//  <Parameter name="host"><![CDATA[localhost]]></Parameter>
//  <Parameter name="user"><![CDATA[osm]]></Parameter>
//  <Parameter name="port"><![CDATA[4321]]></Parameter>
//  <Parameter name="password"><![CDATA[osm]]></Parameter>
//
function replacePostgisParameters(xmlString, params) {
  let newXmlString = xmlString;
  _.forEach(params, (val, key) => {
    const re = new RegExp(`<Parameter name="${key}"><\\!\\[CDATA\\[(.*)\\]\]><\\/Parameter>`, 'g');
    newXmlString = newXmlString.replace(re, `<Parameter name="${key}"><![CDATA[${val}]]></Parameter>`);
  });
  return newXmlString;
}

function replacePostgisParametersString(xmlString) {
  return replacePostgisParameters(xmlString, {
    dbname: config.MAPNIK_POSTGIS_DBNAME || 'osm',
    host: config.MAPNIK_POSTGIS_HOST || 'localhost',
    port: config.MAPNIK_POSTGIS_PORT || '5432',
    user: config.MAPNIK_POSTGIS_USER || 'osm',
    password: config.MAPNIK_POSTGIS_PASSWORD || 'osm',
  });
}

function getAutogenStylePath(stylesheetPath) {
  const styleName = path.basename(stylesheetPath, '.xml');
  const stylesheetDir = path.dirname(stylesheetPath);
  const newPath = path.join(stylesheetDir, `${styleName}${AUTOGEN_SUFFIX}.xml`);
  return newPath;
}

// We need to write the new style into file, because data files (shapefiles) are relative to the
// stylesheet path. If we would use fromString method, the filepath base needs to be
// given as an option. This works in render service, but inside tile service we don't have that
// possibility
async function replacePostgisParametersFile(stylesheetPath) {
  const xmlString = await fs.readFileAsync(stylesheetPath, { encoding: 'utf8' });

  const newXmlString = replacePostgisParametersString(xmlString);
  const newPath = getAutogenStylePath(stylesheetPath);

  await fs.writeFileAsync(newPath, newXmlString, { encoding: 'utf8' });
  return newPath;
}

function replacePostgisParametersFileSync(stylesheetPath) {
  const xmlString = fs.readFileSync(stylesheetPath, { encoding: 'utf8' });

  const newXmlString = replacePostgisParametersString(xmlString);
  const newPath = getAutogenStylePath(stylesheetPath);

  fs.writeFileSync(newPath, newXmlString, { encoding: 'utf8' });
  return newPath;
}

module.exports = {
  replacePostgisParameters,
  replacePostgisParametersFile,
  replacePostgisParametersFileSync,
  AUTOGEN_SUFFIX,
};
