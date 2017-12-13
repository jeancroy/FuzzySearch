extend(FuzzySearch.prototype, /** @lends {FuzzySearch.prototype} */ {

    /**
     * Take a `sourceItem` (original from source) and keys, produce an `item`
     * that is ready to be added to `this.index`.
     *
     * Preparation steps:
     * - Apply lowercase, accent removal
     * - Split field into token
     * - Remove small token eg "a" "of" and prefix large token
     */
    _prepItem: function (sourceItem, keys) {

        var item_fields = FuzzySearch.generateFields(sourceItem, keys);

        var nb_fields = item_fields.length;

        for (var field_index = -1; ++field_index < nb_fields;) {

            var field = item_fields[field_index];
            for (var node_index = -1, nb_nodes = field.length; ++node_index < nb_nodes;) {

                var norm = this.options.normalize(field[node_index]);
                var nodes = norm.split(this.token_re);
                //Filter size. (If total field length is very small, make an exception.
                // Eg some movie/Book have a single letter title, filter risk of removing everything )
                if (norm.length > 2 * this.options.token_field_min_length) nodes = FuzzySearch.filterSize(nodes, this.options.token_field_min_length, this.options.token_field_max_length);
                if (this.options.score_acronym) nodes.push(norm.replace(this.acro_re, "$1"));
                field[node_index] = nodes;

            }

        }

        return new Indexed(sourceItem, item_fields);
    },

    /**
     * Add an item to the index, temporarily
     * Overwrites existing items with new content, or inserts new items.
     *
     * The item will be indexed and included in `this.index`, but `this.source`
     * will retain the value of the original source.
     *
     * WARN: Setting `this.dirty = true` and performing a search will revert the
     * index to be based on the the original `source` value, before items were
     * added.
     *
     * Uses the identify_item option for determining item uniqueness.
     * If identify_item is null (default), calling this method is append-only with no duplicate detection.
     */
    add: function (sourceItem) {
        var itemId = typeof this.options.identify_item === "function"
            ? this.options.identify_item(sourceItem)
            : null;
        var item = this._prepItem(sourceItem, this.keys);

        if (itemId === null) {
            this.index[this.nb_indexed] = item;
            this.nb_indexed++;
        }
        else if (itemId in this.index_map) {
            this.index[this.index_map[itemId]] = item;
        }
        else {
            this.index_map[itemId] = this.nb_indexed;
            this.index[this.nb_indexed] = item;
            this.nb_indexed++;
        }
    },

    /**
     * Build (or rebuild) `this.index` from `this.source`
     * Flatten object into array using specified keys
     *
     * @private
     */

    _buildIndexFromSource: function () {
        var nb_items = this.source.length;

        this.index = new Array(nb_items);
        this.index_map = {};
        this.nb_indexed = 0;

        for (var item_index = -1; ++item_index < nb_items;) {
            var sourceItem = this.source[item_index];
            this.add(sourceItem);
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

function Indexed(sourceItem, fields) {
    this.item = sourceItem;
    this.fields = fields;
}

// - - - - - - - - - - - - - - - - - - - - - -
//   Input stage: prepare field for search
//- - - - - - - - - - - - - - - - - - - - - -


/**
 * Given an object to index and a list of field to index
 * Return a flat list of the values.
 *
 * @param {Object} obj
 * @param {Array.<string>} fieldlist
 * @returns {Array}
 */

FuzzySearch.generateFields = function (obj, fieldlist) {

    if (!fieldlist || !fieldlist.length) return [[obj.toString()]];

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
