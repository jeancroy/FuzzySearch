//
// - - - - - - - - - - - -
//  OUTPUT OR POST PROCESS
// - - - - - - - - - - - -
//

extend(FuzzySearch.prototype, /** @lends {FuzzySearch.prototype} */ {

    /**
     * Given a SearchResult object, recover the value of the best matching field.
     * This is done on demand for display.
     *
     * @param {SearchResult} result
     * @return {string} original field
     */

    getMatchingField: function (result) {
        var f = FuzzySearch.generateFields(result.item, [this.keys[result.matchIndex]]);
        return f[0][result.subIndex];
    },

    /**
     * Given a SearchResult object, generate a new object that follow alias structure
     * @param {SearchResult} result
     * @return {*} aliased result
     */

    aliasResult: function (result) {

        var options = this.options;
        var f = FuzzySearch.generateFields(result.item, this.keys);
        var out = {}, tags = this.tags, join_str = options.join_str;

        for (var i = -1, n = f.length; ++i < n;) {
            out[tags[i]] = f[i].join(join_str)
        }

        out._item = result.item;
        out._score = result.score;
        out._match = f[result.matchIndex][result.subIndex];

        return out;

    }

});


// - - - - - - - - - - - - - - - - - - - - - -
//   Output stage, prepare results for return
//- - - - - - - - - - - - - - - - - - - - - -

/**
 * Own version of Array.prototype.map()
 *
 * @param {Array} source
 * @param  transform callback
 * @param {*=} context (*this* in called function)
 * @param {number=} max_out
 * @returns {Array}
 */

FuzzySearch.map = function (source, transform, context, max_out) {

    var n = source.length;
    if (max_out > 0 && max_out < n) n = max_out;
    if (typeof transform !== "function") return source.slice(0, n);

    var out = new Array(n);
    for (var i = -1; ++i < n;) {
        out[i] = transform.call(context, source[i], i, source);
    }

    return out;

};

/**
 * Take an array of objects, return an array containing a field of those object.
 *
 * test = [ {key:"A",value:10}, {key:"B",value:20}  ]
 * mapField(test,"value") = [10,20]
 *
 * @param source - array to process
 * @param {string} path - key to address on each item OR function to apply
 * @param {Number=} [max_out=source.length] - only process first items
 * @returns {Array}
 */

FuzzySearch.mapField = function (source, path, max_out) {

    var n = source.length;
    if (max_out > 0 && max_out < n) n = max_out;
    if (path === "") return source.slice(0, n);

    var out = new Array(n);
    var obj, i;


    if (path.indexOf(".") === -1) {
        //fast case no inner loop
        for (i = -1; ++i < n;) {
            obj = source[i];
            if (path in obj) out[i] = obj[path];
        }

    } else {

        //general case
        var parts = path.split(".");
        var nb_level = parts.length;

        for (i = -1; ++i < n;) {
            obj = source[i];

            for (var level = -1; ++level < nb_level;) {
                var key = parts[level];
                if (!(key in obj)) break;
                obj = obj[key];
            }

            out[i] = obj;
        }

    }

    return out;

};

/**
 * Filter array for item where item[field] >= atleast
 *
 * @param array
 * @param field
 * @param atleast
 * @returns {Array}
 */

FuzzySearch.filterGTE = function (array, field, atleast) {
    var i = -1, j = -1;
    var n = array.length;
    var out = [], obj;

    while (++i < n) {
        obj = array[i];
        if (obj[field] >= atleast) {
            out[++j] = obj;
        }
    }

    return out;
};


/**
 * SearchResult constructor
 * - Internal result list
 * - Output of search when output_map=""
 *
 * @param {*} item
 * @param {Array} fields
 * @param {number} item_score
 * @param {number} matched_field_index
 * @param {number} matched_field_sub
 * @param {(string|number)} sortkey
 * @constructor
 */

function SearchResult(item, fields, item_score, matched_field_index, matched_field_sub, sortkey) {
    this.item = item;
    this.fields = fields;
    this.score = item_score;
    this.matchIndex = matched_field_index;
    this.subIndex = matched_field_sub;
    this.sortKey = sortkey;
}


/**
 * Sort function
 * first by decreasing order of score, then alphabetical order of sortkey.
 *
 * @param {SearchResult} a
 * @param {SearchResult} b
 * @returns {number} -  ">0" if b before a, "<0" if b after a.
 */
function compareResults(a, b) {
    var d = b.score - a.score;
    if (d !== 0) return d;
    var ak = a.sortKey, bk = b.sortKey;
    return ak > bk ? 1 : ( ak < bk ? -1 : 0);
}
