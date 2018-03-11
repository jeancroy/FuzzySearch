//
// Shared string and array of string functions
//
'use strict';


/**
 * Take a string into a normal form. Allow to compare in a case insensitive way.
 * Also allow to match accents with their base form "é" vs "e"
 * Finally standardize token separator to be a single space.
 *
 * @param {string} str
 * @returns {string} - normalized str
 */

function normalize(str) {
    if (!str)return "";
    return str.toLowerCase().replace(/[^\u0000-\u007E]/g, function (a) {
        return diacriticsMap[a] || a;
    });
}

function getDiacriticsMap() {
    // replace most common accents in french-spanish by their base letter
    //"ãàáäâæẽèéëêìíïîõòóöôœùúüûñç"
    var from = "\xE3\xE0\xE1\xE4\xE2\xE6\u1EBD\xE8\xE9\xEB\xEA\xEC\xED\xEF\xEE\xF5\xF2\xF3\xF6\xF4\u0153\xF9\xFA\xFC\xFB\xF1\xE7";
    var to = "aaaaaaeeeeeiiiioooooouuuunc";
    var diacriticsMap = {};
    for (var i = 0; i < from.length; i++) {
        diacriticsMap[from[i]] = to[i]
    }
    return diacriticsMap;
}

var diacriticsMap = getDiacriticsMap();

/**
 * Process an array of string, filter out item smaller than min, trim item larger than max.
 *
 * @param {Array.<string>} array - array of string
 * @param minSize - filter out item smaller than this
 * @param maxSize - substring item larger than this
 * @returns {Array}
 */

FuzzySearch.filterSize = function (array, minSize, maxSize) {
    var i = -1, j = -1;
    var n = array.length;
    var out = [];
    var str, slen;

    while (++i < n) {
        str = array[i];
        slen = str.length;
        if (slen >= minSize) out[++j] = (slen < maxSize) ? str : str.substr(0, maxSize)
    }
    return out;
};

