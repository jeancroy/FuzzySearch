'use strict';

extend(FuzzySearch.prototype, /** @lends {FuzzySearch.prototype} */ {

    /**
     *
     * @param  {Indexed} preparedItem
     * @param  {int} idx
     */
    _storeAdd: function (preparedItem, idx) {

        var keyList = keysFromIndexedItem(preparedItem);
        if (keyList.length == 0) return;

        // register idx on all appropriate key
        for (var i = 0; i < keyList.length; i++) {
            var key = keyList[i];

            if (key in this.store) {
                // append to existing array of index
                this.store[key].push(idx);
            }
            else {
                // Format is dict key => array of item index
                this.store[key] = [idx];
            }
        }


    },


    /**
     *
     * @param  {Query} preparedQuery
     * @param  {Array.<Indexed>} source
     */
    _storeSearch: function (preparedQuery, source) {

        // Scan query for index keys.
        var keyList = keysFromQuery(preparedQuery);
        if (keyList.length == 0) return [];

        // return filtered source
        var idAndCount = retrieveCount(keyList, this.store);
        if (idAndCount.length == 0) return [];

        // Get minimum quality and remap to original items.
        var tresh = idAndCount[0].count * this.options.store_thresh;
        idAndCount = FuzzySearch.filterGTE(idAndCount, "count", tresh);
        return FuzzySearch.map(idAndCount, function (x) {
            return source[x.id]
        });

    }

});

/**
 *
 * @param  {Indexed} preparedItem
 */

function keysFromIndexedItem(preparedItem) {

    // Process the nested structure of a prepared item in order to extract index keys.
    var keyList = [];
    var keyDict = {};

    // item -> fields -> nodes -> word_tokens
    var fields = preparedItem.fields;
    for (var i = 0; i < fields.length; i++) {
        var nodes = fields[i];
        for (var j = 0; j < nodes.length; j++) {
            var words = nodes[j];
            for (var k = 0; k < words.length; k++) {
                keysFromWord(words[k], keyList, keyDict)
            }
        }
    }

    return keyList;
}

/**
 *
 * @param  {Query} query
 */

function keysFromQuery(query) {

    var keyList = [];
    var keyDict = {};
    var i, j;

    var words = query.words;
    for (i = 0; i < words.length; i++) {
        keysFromWord(words[i], keyList, keyDict)
    }

    var children = query.children;
    for (i = 0; i < children.length; i++) {
        words = children[i].words;
        for (j = 0; j < words; j++) {
            keysFromWord(words[j], keyList, keyDict)
        }
    }

    return keyList;

}


function keysFromWord(word, keysList, existingDict) {

    var len = word.length;
    if (len == 0) return;

    if (len >= 3) {
        // 3o6, 3o5, 3o4, 3o3
        select3(word, 6, keysList, existingDict)
    }

    if (len >= 2) {
        // 2o4, 2o3,2o2
        select2(word, 4, keysList, existingDict)
    }

    // 1o1 strategy: This index by first letter
    union(word[0], keysList, existingDict);

}

function select2(str, maxlen, existingList, existingDict) {
    var len = Math.min(str.length, maxlen);
    for (var i = 0; i < len - 1; i++) {
        for (var j = i + 1; j < len; j++) {
            union(str[i] + str[j], existingList, existingDict)
        }
    }
    return existingList;
}

function select3(str, maxlen, existingList, existingDict) {
    var len = Math.min(str.length, maxlen);
    for (var i = 0; i < len - 2; i++) {
        for (var j = i + 1; j < len - 1; j++) {
            for (var k = j + 1; k < len; k++) {
                union(str[i] + str[j] + str[k], existingList, existingDict)
            }
        }
    }
    return existingList;
}


function union(word, existingList, existingDict) {
    if (!(word in existingDict)) {
        existingDict[word] = true;
        existingList.push(word);
    }
}

function retrieveCount(keys, store) {

    // Dictionary idx => count
    var countPerIndex = {};

    if (keys.length == 0)
        return [];

    for (var i = 0; i < keys.length; i++) {

        var key = keys[i];

        // Does the key exist in the index ?
        if (key in store) {

            // If so add every entry of that key into countPerIndex
            // Also for each entry, maintain a count of matched keys.

            var idxList = store[key];
            for (var j = 0; j < idxList.length; j++) {

                var idx = idxList[j];

                if (idx in countPerIndex) {
                    countPerIndex[idx]++;
                } else {
                    countPerIndex[idx] = 1;
                }
            }

        }
    }

    // Transform countPerIndex into a sorted list of IdAndCount

    var outList = [];

    for (var id in countPerIndex) {
        if (countPerIndex.hasOwnProperty(id)) {
            outList.push(new IdAndCount(id, countPerIndex[id]));
        }
    }

    // We can probably filterGte here.

    // Custom sort decreasing order
    outList = outList.sort(function (a, b) {
        return b.count - a.count
    });

    return outList;

}

function IdAndCount(id, count) {
    this.id = id;
    this.count = count;
}