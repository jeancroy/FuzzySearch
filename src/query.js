//
// - - - - - - - - - - - -
//  Prepare Query
// - - - - - - - - - - - -
//

extend(FuzzySearch.prototype, /** @lends {FuzzySearch.prototype} */ {


    /**
     * Input: a user search string
     * Output a query object
     *
     * Perform a few transformation to allw faster searching.
     * String is set to lowercase, some accents removed, split into tokens.
     * Token too small are filtered out, token too large are trimmed.
     * Token are packed in group of 32 char, each token is processed to extract an alphabet map.
     *
     * If score_test_fused is enabled, we do an extra pass disregarding tokens.
     * IF score_per_token is disabled this is the only pass we do.
     *
     * @param query_string
     * @returns {Query}
     * @private
     */

    _prepQuery: function (query_string) {

        var options = this.options;
        var opt_tok = options.score_per_token;
        var opt_fuse = options.score_test_fused;
        var opt_fuselen = options.token_fused_max_length;
        var opt_qmin = options.token_field_min_length;
        var opt_qmax = options.token_field_max_length;

        var tags = this.tags;
        var tags_re = this.tags_re;
        var nb_tags = tags.length;
        var token_re = this.token_re;

        var norm, fused, fused_map, children, has_tags, group, words;

        if (opt_tok && nb_tags && tags_re) {

            var start = 0, end;
            var q_index = 0;
            var q_parts = new Array(nb_tags + 1);

            var match = tags_re.exec(query_string);
            has_tags = (match !== null);

            while (match !== null) {
                end = match.index;
                q_parts[q_index] = query_string.substring(start, end);
                start = end + match[0].length;
                q_index = tags.indexOf(match[1]) + 1;
                match = tags_re.exec(query_string);
            }

            q_parts[q_index] = query_string.substring(start);

            children = [];

            for (var i = -1; ++i < nb_tags;) {

                var qp = q_parts[i + 1];
                if (!qp || !qp.length) continue;

                norm = options.normalize(qp);
                fused = norm.substring(0, opt_fuselen);
                fused_map = (opt_fuse || !opt_tok) ? FuzzySearch.alphabet(fused) : {};
                words = FuzzySearch.filterSize(norm.split(token_re), opt_qmin, opt_qmax);
                group = FuzzySearch.pack_tokens(words);

                children[i] = new Query(norm, words, group, fused, fused_map, false, []);
            }


            norm = options.normalize(q_parts[0]);
            words = FuzzySearch.filterSize(norm.split(token_re), opt_qmin, opt_qmax);
            group = FuzzySearch.pack_tokens(words);

        }

        else {
            norm = options.normalize(query_string);
            words = FuzzySearch.filterSize(norm.split(token_re), opt_qmin, opt_qmax);
            group = opt_tok ? FuzzySearch.pack_tokens(words) : [];
            has_tags = false;
            children = new Array(nb_tags);
        }

        fused = norm.substring(0, opt_fuselen);
        fused_map = (opt_fuse || !opt_tok) ? FuzzySearch.alphabet(fused) : {};

        return new Query(norm, words, group, fused, fused_map, has_tags, children)

    }
});

//
// Query objects
//

/**
 * Hold a query
 *
 * @param {string} normalized
 * @param {Array.<string>} words
 * @param {Array.<PackInfo>} tokens_groups
 * @param {string} fused_str
 * @param {Object} fused_map
 * @param {boolean} has_children
 * @param {Array<Query>} children
 *
 * @constructor
 */

function Query(normalized, words, tokens_groups, fused_str, fused_map, has_children, children) {

    this.normalized = normalized;
    this.words = words;
    this.tokens_groups = tokens_groups;

    this.fused_str = fused_str;
    this.fused_map = fused_map;
    this.fused_score = 0;

    this.has_children = has_children;
    this.children = children;

}

//
// Query hold some memory to keep score of it's tokens.
// Used in search methods

/**
 * Loop tru each item score and reset to 0, apply to child query
 */
Query.prototype.resetItem = function () {
    var groups = this.tokens_groups;

    for (var group_index = -1, nb_groups = groups.length; ++group_index < nb_groups;) {
        var score_item = groups[group_index].score_item;
        for (var i = -1, l = score_item.length; ++i < l;) score_item[i] = 0

    }

    this.fused_score = 0;

    if (this.has_children) {
        var children = this.children;
        for (var child_index = -1, nb_child = children.length; ++child_index < nb_child;) {
            var child = children[child_index];
            if (child) child.resetItem();
        }
    }

};

/**
 * Sum each item score and add to child score
 */
Query.prototype.scoreItem = function () {

    var query_score = 0;
    var groups = this.tokens_groups;

    for (var group_index = -1, nb_groups = groups.length; ++group_index < nb_groups;) {
        var group_scores = groups[group_index].score_item;
        for (var score_index = -1, nb_scores = group_scores.length; ++score_index < nb_scores;) {
            query_score += group_scores[score_index]
        }
    }

    if (this.fused_score > query_score) query_score = this.fused_score;

    if (this.has_children) {
        var children = this.children;
        for (var child_index = -1, nb_child = children.length; ++child_index < nb_child;) {
            var child = children[child_index];
            if (child) query_score += child.scoreItem();
        }
    }

    return query_score;

};


/**
 * Hold a group of token for parallel scoring
 *
 * @param {Array.<string>} group_tokens
 * @param {Object} group_map
 * @param {number} gate
 * @constructor
 */

function PackInfo(group_tokens, group_map, gate) {
    this.tokens = group_tokens;
    this.map = group_map;
    this.gate = gate;

    var t = group_tokens.length, i = -1;
    var scores = new Array(t);
    while (++i < t) scores[i] = 0;

    this.score_item = scores.slice();
    this.score_field = scores.slice();
    this.field_pos = scores;
}

//
// - - - - - - - - - - - - - - - - -
//     Prepare Token for search
// - - - - - - - - - - - - - - - - -
// a normal string can be view as an array of char.
// so we map ( position -> char).
//
// we reverse that relation to map
// char -> positions

/**
 * Record position of each character in a token.
 * If token is small, position is recorded by position of a single bit in an int.
 * If token is larger than INT_SIZE, position is recorder as array of number.
 *
 * @param {string} token
 * @returns {Object} key value map char->positions (as array of position or single int (can be seen as an array of bit) )
 */
FuzzySearch.alphabet = function (token) {
    var len = token.length;
    if (len > INT_SIZE) return FuzzySearch.posVector(token);
    else return FuzzySearch.bitVector(token, {}, 0);
};

/**
 * Apply FuzzySearch.alphabet on multiple tokens
 *
 * @param {Array.<string>} tokens
 * @returns {Array.<Object>}
 */
FuzzySearch.mapAlphabet = function (tokens) {
    var outlen = tokens.length;
    var out = new Array(outlen), i = -1;
    while (++i < outlen) {
        var t = tokens[i];
        if (t.length > INT_SIZE) out[i] = FuzzySearch.posVector(t);
        else out[i] = FuzzySearch.bitVector(t, {}, 0);
    }
    return out;
};

/**
 * Record position of each char using a single bit
 *
 * @param {string} token
 * @param {Object} map - Existing map to modify, can init with {}
 * @param offset - used for packing multiple word in a single map, can init with 0
 * @returns {Object} Key value map char -> int
 */

FuzzySearch.bitVector = function (token, map, offset) {

    var len = token.length;
    var i = -1, c;
    var b = offset;

    while (++i < len) {
        c = token[i];
        if (c in map) map[c] |= (1 << b++);
        else map[c] = (1 << b++);
    }

    return map;

};

/**
 * Record position of each char in a token using an array
 * Append Infinity as a stop marker for llcs_large
 *
 * map = posVector("position")
 * map["p"] -> [0,Inf]
 * map["o"] -> [1,6,Inf]
 *
 * @param {string} pattern
 * @returns {Object} - key value map char->array of position (as number)
 */
FuzzySearch.posVector = function (pattern) {

    var map = {}, c;

    var m = pattern.length, i = -1;
    while (++i < m) {
        c = pattern[i];
        if (c in map) map[c].push(i);
        else map[c] = [i];
    }

    for (c in map) {
        if (map.hasOwnProperty(c)) {
            map[c].push(Infinity);
        }
    }

    return map;

};

/**
 * Given a list of tokens, pack them into group of upto INT_SIZE(32) chars.
 * If a single token is bigger than INT_SIZE create a groupe of a single item
 * And use posVector instead of bitVector to prepare fallback algorithm.
 *
 * @param {Array.<string>} tokens
 * @returns {Array.<PackInfo>}
 */
FuzzySearch.pack_tokens = function (tokens) {

    var token_index = -1;
    var nb_tokens = tokens.length;
    var large;
    var groups = [];

    //For each group
    while (token_index < nb_tokens) {

        var group_tokens = [];
        var group_map = {};
        var offset = 0;
        var gate = 0;

        //For each token in the group
        while (++token_index < nb_tokens) {

            var token = tokens[token_index];
            var l = token.length;

            if (l >= INT_SIZE) {

                large = new PackInfo([token],
                    FuzzySearch.posVector(token),
                    0xFFFFFFFF);

                break;

            }
            else if (l + offset >= INT_SIZE) {
                token_index--;
                break;
            }
            else {
                group_tokens.push(token);
                FuzzySearch.bitVector(token, group_map, offset);
                gate |= ( (1 << ( token.length - 1) ) - 1 ) << offset;
                offset += l
            }

        }

        if (group_tokens.length > 0) {
            groups.push(new PackInfo(group_tokens, group_map, gate));
        }

        if (large) {
            groups.push(large);
            large = null;
        }

    }

    return groups;

};
