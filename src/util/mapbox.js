// Modified version of ./lib/mapbox-flow.js
// Changes:
//   * Fixed normalizeGlyphsURL (font and range)
//   * Add normalizeVectorTileURL


'use strict';

const config = {
    API_URL: 'https://api.mapbox.com',
    REQUIRE_ACCESS_TOKEN: true,
};

function normalizeURL(url, pathPrefix, accessToken) {
    accessToken = accessToken || config.ACCESS_TOKEN;

    if (!accessToken && config.REQUIRE_ACCESS_TOKEN) {
        throw new Error('An API access token is required to use Mapbox GL. ' +
            'See https://www.mapbox.com/developers/api/#access-tokens');
    }

    url = url.replace(/^mapbox:\/\//, config.API_URL + pathPrefix);
    url += url.indexOf('?') !== -1 ? '&access_token=' : '?access_token=';

    if (config.REQUIRE_ACCESS_TOKEN) {
        if (accessToken[0] === 's') {
            throw new Error('Use a public access token (pk.*) with Mapbox GL JS, not a secret access token (sk.*). ' +
                'See https://www.mapbox.com/developers/api/#access-tokens');
        }

        url += accessToken;
    }

    return url;
}

module.exports.normalizeStyleURL = function(url, accessToken) {
    if (!url.match(/^mapbox:\/\/styles\//))
        return url;

    var split = url.split('/');
    var user = split[3];
    var style = split[4];
    var draft = split[5] ? '/draft' : '';
    return normalizeURL('mapbox://' + user + '/' + style + draft, '/styles/v1/', accessToken);
};

module.exports.normalizeSourceURL = function(url, accessToken) {
    if (!url.match(/^mapbox:\/\//))
        return url;

    // TileJSON requests need a secure flag appended to their URLs so
    // that the server knows to send SSL-ified resource references.
    return normalizeURL(url + '.json', '/v4/', accessToken) + '&secure';
};

module.exports.normalizeGlyphsURL = function(url, accessToken) {
    if (!url.match(/^mapbox:\/\//))
        return url;

    var split = url.split('/');
    var user = split[3];
    var font = split[4];
    var range = split[5];
    return normalizeURL('mapbox://' + user + '/' + font + '/' + range + '.pbf', '/fonts/v1/', accessToken);
};

module.exports.normalizeSpriteURL = function(url, format, ext, accessToken) {
    if (!url.match(/^mapbox:\/\/sprites\//))
        return url + format + ext;

    var split = url.split('/');
    var user = split[3];
    var style = split[4];
    var draft = split[5] ? '/draft' : '';
    return normalizeURL('mapbox://' + user + '/' + style + draft + '/sprite' + format + ext, '/styles/v1/', accessToken);
};

// Our custom method to resolve tile urls
module.exports.normalizeVectorTileURL = function(url, accessToken) {
    // Example input url mapbox://tiles/mapbox.mapbox-streets-v6/0/0/0.vector.pbf
    if (!url.match(/^mapbox:\/\/tiles\/.*\/[0-9]+\/[0-9]+\/[0-9]+\.vector\.pbf/))
        return url;

    var split = url.split('/');
    var tileId = split[3];
    var z = split[4];
    var x = split[5];
    var rest = split[6];
    console.log(split);
    return 'https://a.tiles.mapbox.com/v4/' + tileId + '/' + z + '/' + x + '/' +
        rest + '?access_token=' + accessToken;
}

module.exports.normalizeTileURL = function(url, sourceUrl) {
    if (!sourceUrl || !sourceUrl.match(/^mapbox:\/\//))
        return url;
    return url.replace(/\.((?:png|jpg)\d*)(?=$|\?)/, '@2x.$1');
};
