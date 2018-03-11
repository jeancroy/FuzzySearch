/**
 * @param options
 * @constructor
 */
'use strict';

function FuzzySearch(options) {

    if (options === undefined) options = {};
    if (!(this instanceof FuzzySearch)) return new FuzzySearch(options);
    FuzzySearch.setOptions(this, options, FuzzySearch.defaultOptions, _privates, true, this._optionsHook)

}

FuzzySearch.defaultOptions =
/** @lends {FuzzySearchOptions.prototype} */{

    //
    //  Scoring, include in result
    //

    minimum_match: 1.0,               // Minimum score to consider two token are not unrelated
    thresh_include: 2.0,              // To be a candidate, score of item must be at least this
    thresh_relative_to_best: 0.5,     // and be at least this fraction of the best score
    field_good_enough: 20,            // If a field have this score, stop searching other fields. (field score is before item related bonus)

    //
    //  Scoring, bonus
    //

    bonus_match_start: 0.5,          // Additional value per character in common prefix
    bonus_token_order: 2.0,          // Value of two token properly ordered
    bonus_position_decay: 0.7,       // Exponential decay for position bonus (smaller : more importance to first item)

    score_per_token: true,            // if true, split query&field in token, allow to match in different order
                                      // if false, bypass at least half the computation cost, very fast
                                      // also disable different token that score different field, because no more token!!

    score_test_fused: false,          // Try one extra match where we disregard token separation.
                                      // "oldman" match "old man"

    score_acronym: false,             // jrrt match against John Ronald Reuel Tolkien
    token_sep: " .,-:",

    //
    //  Output sort & transform
    //

    score_round: 0.1,                // Two item that have the same rounded score are sorted alphabetically
    output_limit: 0,                 // Return up to N result, 0 to disable

    sorter: compareResults,          // Function used to sort. See signature of Array.sort(sorter)
    normalize: normalize,            // Function used to transform string (lowercase, accents, etc)
    filter: null,                     // Select elements to be searched. (done before each search)

    /**@type {string|function({SearchResult})}*/
    output_map: "item",              // Transform the output, can be a function or a path string.
                                     // output_map="root" return SearchResult object, needed to see the score
                                     // output_map="root.item" return original object.
                                     // output_map="root.item.somefield" output a field of original object.
                                     // (root.) is optional.
                                     //
                                     // output_map=function(root){ return something(root.item) }
                                     // ^this get original object and apply something() on it.

    join_str: ", ",                   //String used to join array fields

    //
    //  Tokens options
    //

    token_query_min_length: 2,       // Avoid processing very small words, include greater or equal, in query
    token_field_min_length: 3,       // include greater or equal, in item field
    token_query_max_length: 64,      // Shorten large token to give more even performance.
    token_field_max_length: 64,      // Shorten large token to give more even performance.
    token_fused_max_length: 64,      // Shorten large token to give more even performance.

    //Do not attempt to match token too different in size: n/m = len(field_tok)/len(query_tok)
    token_min_rel_size: 0.6,         // Field token should contain query token. Reject field token that are too small.
    token_max_rel_size: 10,           // Large field token tend to match against everything. Ensure query is long enough to be specific.


    //
    //  Interactive - suggest as you type.
    //  Avoid doing search that will be discarded without being displayed
    //  This also help prevent lag/ temp freeze
    //

    interactive_debounce: 150,   // This is initial value. Will try to learn actual time cost. Set to 0 to disable.
    interactive_mult: 1.2,       // Overhead for variability and to allow other things to happens (like redraw, highlight ).
    interactive_burst: 3,        // Allow short burst, prevent flicker due to debounce suppression of a callback

    //
    // Data
    //

    source: [],
    keys: [],
    lazy: false, // when true, any refresh happens only when a user make a search, option stay put until changed.
    token_re: /\s+/g, //Separator string will be parsed to this re.

    identify_item: null,  // How to uniquely identify an item when adding to the index. Defaults to null, meaning no duplicate detection. Must be a method that takes a single (source) argument.

    use_index_store: false, // Enable a time vs memory trade-off for faster search (but longer initial warm-up).
    store_thresh: 0.7,      // cutoff point relative to best, to graduate from store phase.
    store_max_results: 1500 // Maximum number of result to graduate from store, to the full search quality algorithm
                            // Note that store only perform a crude search, ignoring some options, so the best result can be only "meh" here.

};


var _privates =
/** @lends {FuzzySearch.prototype} */{

    keys: [],
    tags: [],      // alternative name for each key, support output alias and per key search
    index: [],     // source is processed using keys, then stored here
    index_map: {}, // To manage update of record already in dataset
    nb_indexed: 0, // To manage active count of index
    store: {},     // Dictionary used for time VS memory trade off. (Optional)

    tags_re: null,
    acro_re: null,
    token_re: null,

    /**@type {FuzzySearchOptions}*/
    options: null,
    dirty: false, // when true, schedule a source refresh using new or existing source & keys, used once then clear itself.

    //Information on last search
    query: null,
    results: [],
    start_time: 0,
    search_time: 0

};

/**
 * Number of bit in a int.
 * DEBUG-tip: setting this to zero will force "long string" algorithm for everything!
 * @const
 */
var INT_SIZE = 32;

function FuzzySearchOptions(defaults, options) {
    for (var key in defaults) {
        if (defaults.hasOwnProperty(key)) { //fill self with value from either options or default
            this[key] = (options.hasOwnProperty(key) && options[key] !== undefined ) ? options[key] : defaults[key];
        }
    }
}

FuzzySearchOptions.update = function (self, defaults, options) {
    for (var key in options) {
        if (options.hasOwnProperty(key) && defaults.hasOwnProperty(key)) {
            //explicitly set a options to undefined => reset default, else get value
            self[key] = (options[key] === undefined) ? defaults[key] : options[key];
        }
    }
};

/**
 * Set property of object,
 * Restrict properties that can be set from a list of available defaults.
 *
 * @param {FuzzySearch} self
 * @param {Object} options
 * @param {Object} defaults
 * @param {Object} privates
 * @param {boolean} reset
 * @param {function({Object})} hook
 *
 */
FuzzySearch.setOptions = function (self, options, defaults, privates, reset, hook) {

    if (reset) {
        extend(self, privates);
        self.options = new FuzzySearchOptions(defaults, options);
    } else {
        FuzzySearchOptions.update(self.options, defaults, options);
    }

    hook.call(self, options)
};

function extend(a, b) {
    for (var key in b) if (b.hasOwnProperty(key)) a[key] = b[key];
}


//
// - - - - - - - - - - - -
// SET & PARSE SETTINGS
// - - - - - - - - - - - -
//

extend(FuzzySearch.prototype, /** @lends {FuzzySearch.prototype} */ {

    /**
     * Allow to change options after the object has been created.
     * If source is changed, new source is indexed.
     *
     * Optional reset allow to change any setting not in options to defaults.
     * This is similar to creating new object, but using same pointer.
     *
     * @param {Object} options
     * @param {boolean=} reset
     */

    setOptions: function (options, reset) {
        if (reset === undefined) reset = options.reset || false;
        FuzzySearch.setOptions(this, options, FuzzySearch.defaultOptions, _privates, reset, this._optionsHook);
    },

    /**
     *
     * @param {Object} options
     * @private
     */

    _optionsHook: function (options) {

        //Items of options have been copied into this.options
        //We still test "option_name in option" to know if we have received something new
        //This allow to support "shorthand" options and is used to refresh data.

        var self_options = this.options;

        //Output stage
        if ("output_map" in options && typeof options.output_map === "string") {
            if (self_options.output_map === "alias") self_options.output_map = this.aliasResult;
            else self_options.output_map = removePrefix(self_options.output_map, ["root", "."]);
        }

        this.source = self_options.source;

        // Input stage, work to allow different syntax for keys definition is done here.
        var oKeys;
        if (("keys" in options) && ( ( oKeys = options.keys) !== undefined)) {

            var key_type = Object.prototype.toString.call(oKeys);
            var key_index, nb_keys;

            this.tags = null;

            if (key_type === "[object String]") {
                this.keys = oKeys.length ? [oKeys] : [];
            }

            else if (key_type === "[object Object]") {

                this.keys = [];
                this.tags = []; //we don't know the "length" of dictionary
                key_index = 0;
                for (var tag in oKeys) {
                    if (oKeys.hasOwnProperty(tag)) {
                        this.tags[key_index] = tag;
                        this.keys[key_index] = oKeys[tag];
                        key_index++;
                    }
                }

            }

            else {
                this.keys = oKeys;
            }

            oKeys = this.keys;
            nb_keys = oKeys.length;
            for (key_index = -1; ++key_index < nb_keys;) {
                oKeys[key_index] = removePrefix(oKeys[key_index], ["item", "."])
            }

            if (!this.tags) this.tags = oKeys;
            this.tags_re = buildTagsRE(this.tags);

        }

        if (this.acro_re === null || "acronym_tok" in options) {
            this.acro_re = buildAcronymRE(self_options.token_sep);
        }

        if (this.token_re === null || "token_sep" in options) {
            this.token_re = self_options.token_re = new RegExp("[" + re_escape(self_options.token_sep) + "]+", "g");
        }

        // Determine if we need to rebuild this.index from this.source
        if (options.dirty || ("source" in options) || ("keys" in options) || ("use_index_store" in options)) {
            if (self_options.lazy) this.dirty = true; // Schedule later.
            else {
                this._buildIndexFromSource();
                this.dirty = false;
            }
        }

    }

});

/**
 * Removes optional prefix of paths.
 * for example "root.", "."
 *
 * @param {string} str - input
 * @param {Array<string>} prefixes to remove
 * @returns {string}
 */

function removePrefix(str, prefixes) {
    var n = prefixes.length;
    var offset = 0;

    for (var i = -1; ++i < n;) {
        var p = prefixes[i], l = p.length;
        if (str.substr(offset, l) === p) offset += l;
    }

    return (offset > 0) ? str.substr(offset) : str;
}

function buildTagsRE(tags) {

    var n = tags.length;
    if (!n) return null;

    var tag_str = re_escape(tags[0]);
    for (var i = 0; ++i < n;) {
        tag_str += "|" + re_escape(tags[i]);
    }

    return new RegExp("(?:^|\\s)\\s*(" + tag_str + "):\\s*", "g");

}

function buildAcronymRE(sep) {

    var n = sep.length;
    if (!n) return null;
    var acro_str = re_escape(sep);
    return new RegExp("(?:^|[" + acro_str + "])+([^" + acro_str + "])[^" + acro_str + "]*", "g");

}

// Build regexp for tagged search
function re_escape(str) {
    var re = /[\-\[\]\/\{}\(\)\*\+\?\.\\\^\$\|]/g;
    return str.replace(re, "\\$&");
}
