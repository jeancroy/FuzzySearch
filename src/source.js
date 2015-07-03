extend(FuzzySearch.prototype, /** @lends {FuzzySearch.prototype} */ {

    //
    // - - - - - - - - - - - -
    // PROCESS INPUT DATA
    // - - - - - - - - - - - -
    //

    /**
     * Add or replace data to search in.
     * Flatten object into array using specified keys,
     * Apply lowercase, accent removal
     * Split field into token
     * Remove small token eg "a" "of" and prefix large token
     *
     * @param {Array.<Object>} source
     * @param {Array.<string>} keys
     * @param {boolean} overwrite
     * @private
     *
     */

    _prepSource: function (source, keys, overwrite) {

        var nb_items = source.length, out_index;

        if (overwrite) {
            this.index = new Array(nb_items);
            out_index = 0
        } else
            out_index = nb_items;

        var index = this.index;
        var min_size = this.token_field_min_length;
        var max_size = this.token_field_max_length;

        var acronym = this.score_acronym;
        var acronym_re = this.acro_re;

        for (var item_index = -1; ++item_index < nb_items;) {

            var item = source[item_index];
            var item_fields = FuzzySearch.generateFields(item, keys);

            var nb_fields = item_fields.length;

            for (var field_index = -1; ++field_index < nb_fields;) {

                var field = item_fields[field_index];
                for (var node_index = -1, nb_nodes = field.length; ++node_index < nb_nodes;) {

                    var norm = this.normalize(field[node_index]);
                    var nodes = FuzzySearch.filterSize(norm.split(" "), min_size, max_size);
                    if (acronym) nodes.push(norm.replace(acronym_re, "$1"));
                    field[node_index] = nodes;

                }

            }

            index[out_index++] = new Indexed(item, item_fields);

        }

    }
});

/**
 * Original item with cached normalized field
 *
 * @param {*} original
 * @param {Array.<string>} fields
 * @constructor
 */

function Indexed(original, fields) {
    this.item = original;
    this.fields = fields;
}

// - - - - - - - - - - - - - - - - - - - - - -
//   Input stage: prepare field for search
//- - - - - - - - - - - - - - - - - - - - - -

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
    return str.toLowerCase().replace(/\s+/g, " ").replace(/[^\u0000-\u007E]/g, function (a) {
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
 * Given an object to index and a list of field to index
 * Return a flat list of the values.
 *
 * @param {Object} obj
 * @param {Array.<string>} fieldlist
 * @returns {Array}
 */

FuzzySearch.generateFields = function (obj, fieldlist) {

    if (!fieldlist.length) return [[obj.toString()]];

    var n = fieldlist.length;
    var indexed_fields = new Array(n);

    for (var i = -1; ++i < n;)
        indexed_fields[i] = _collectValues(obj, fieldlist[i].split("."), [], 0);

    return indexed_fields;

};


/**
 * Traverse an object structure to collect item specified by parts.
 * If leaf node is an array or dictionary collect every children.
 * If key is wildcard '*' branch out the search process on each children.
 *
 * @param {*} obj - root to process
 * @param {Array.<string>} parts - array of subkey to direct object traversal  "those.that.this"->["those","that","this"]
 * @param {Array} list - where to put collected items
 * @param {number} level - index of current position on parts list
 * @returns {Array} - return list
 * @private
 */
function _collectValues(obj, parts, list, level) {

    var key, i, olen;
    var nb_level = parts.length;
    while (level < nb_level) {

        key = parts[level++];
        if (key === "*" || key === "") break;
        if (!(key in obj)) return list;
        obj = obj[key];

    }

    var type = Object.prototype.toString.call(obj);
    var isArray = ( type === '[object Array]'  );
    var isObject = ( type === '[object Object]' );

    if (level === nb_level) {

        if (isArray)
            for (i = -1, olen = obj.length; ++i < olen;) list.push(obj[i].toString());

        else if (isObject) {
            for (key in obj) {
                if (obj.hasOwnProperty(key)) list.push(obj[key].toString());
            }
        }

        else list.push(obj.toString());


    }

    else if (key === "*") {

        if (isArray)
            for (i = -1, olen = obj.length; ++i < olen;) {
                _collectValues(obj[i], parts, list, level);
            }

        else if (isObject)
            for (key in obj) {
                if (obj.hasOwnProperty(key))
                    _collectValues(obj[key], parts, list, level);
            }
    }

    return list;
}

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