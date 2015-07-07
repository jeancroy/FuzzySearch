//
// Extend base option to support highlight
//
'use strict';

extend(FuzzySearch.defaultOptions, /** @lends {FuzzySearchOptions.prototype} */{

    highlight_prefix: false,         // true: force prefix as part of highlight, (false: minimum gap, slower)
    highlight_bridge_gap: 2,         // display small gap as substitution, set to size of gap, 0 to disable
    highlight_before: '<strong class="highlight">',  //tag to put before/after the highlight
    highlight_after: '</strong>'

});


/**
 * Highlight a string using query stored in a FuzzySearch object.
 * @param {string} str
 * @param {string=} field
 */
FuzzySearch.prototype.highlight = function (str, field) {
    var i, subq;
    var qnorm = this.query.normalized;
    if (field && field.length && (i = this.tags.indexOf(field)) > -1 && (subq = this.query.children[i])) qnorm += (qnorm.length ? " " : "") + subq.normalized;
    return FuzzySearch.highlight(qnorm, str, this.options)
};

/**
 * Highlight string b, from searching a in it.
 *
 * @param {string} a - string to search
 * @param {string} b - string to highlight
 * @param {FuzzySearchOptions=} options
 *
 */
FuzzySearch.highlight = function (a, b, options) {

    if (options === undefined) options = FuzzySearch.defaultOptions;
    if (!b) return "";

    var open_string = options.highlight_before;
    var close_string = options.highlight_after;
    var opt_score_tok = options.score_per_token;
    var opt_fuse = options.score_test_fused;
    var opt_acro = options.score_acronym;
    var token_re = options.token_re;

    var aa = options.normalize(a);
    var bb = options.normalize(b);

    //Normalized needle
    var a_tokens = aa.split(token_re);

    //Normalized haystack
    var b_tokens = bb.split(token_re);

    //Original spelling haystack
    var disp_tokens = [], disp_sep = [];
    splitKeepSep(b, token_re, disp_tokens, disp_sep);


    var strArr = [];
    var match_list = [];
    var fused_score = 0, match_score = 0;

    if (opt_score_tok) {
        match_score = FuzzySearch.matchTokens(b_tokens, a_tokens, match_list, options, false);
    }

    //Test "space bar is broken" no token match
    if (opt_fuse || !opt_score_tok || opt_acro) fused_score = FuzzySearch.score_map(aa, bb, FuzzySearch.alphabet(aa), options) + options.bonus_token_order;

    if (match_score === 0 && fused_score === 0) return b; //shortcut no match


    if (!opt_score_tok || fused_score > match_score) {
        a_tokens = [aa]; //everything in a single token
        b_tokens = [bb];
        disp_tokens = [b];
        match_list = [0];
    }

    var nbtok = disp_tokens.length, j = -1;
    while (++j < nbtok) {

        var i = match_list[j];

        if (i === -1) {
            strArr.push(disp_tokens[j] + disp_sep[j]);
            continue;
        }

        var ta = a_tokens[i];
        var tb = b_tokens[j];
        var td = disp_tokens[j];
        var curr = 0;

        var start_positions = [];
        var end_positions = [];
        FuzzySearch.align(ta, tb, start_positions, end_positions);
        var len = start_positions.length;

        var k = -1;
        while (++k < len) {

            var s = start_positions[k];
            var e = end_positions[k];
            if (s > curr) strArr.push(td.substring(curr, s));
            strArr.push(open_string + td.substring(s, e) + close_string);
            curr = e;

        }

        strArr.push(td.substring(curr) + disp_sep[j]);

    }

    return strArr.join('');

};


function splitKeepSep(str, pattern, tokens, seps) {

    var tok_index = tokens.length;

    var match = pattern.exec(str);
    if (match === null) {
        tokens[tok_index] = str;
        seps[tok_index] = "";
        return;
    }

    var start = 0, end, len;
    while (match !== null) {
        end = match.index;
        len = match[0].length;
        tokens[tok_index] = str.substring(start, end);
        seps[tok_index] = str.substr(end, len);
        start = end + len;
        tok_index++;
        match = pattern.exec(str);
    }

    tokens[tok_index] = str.substring(start);
    seps[tok_index] = "";


}


//
// Smith-Waterman-Gotoh local Alignment
//
// Smith&Waterman worked the idea of local alignment
// While Gotoh 82  worked on affine gap penalty.
//
// This is the basic algorithm with some optimisation to use less space.
// JAligner has been used as a reference implementation to debug.
// Some of their implementation detail to save memory has been reused here.
//
// See pseudo-code on
// http://jaligner.sourceforge.net/api/jaligner/SmithWatermanGotoh.html
//
//

/**
 * Smith-Waterman-Gotoh local Alignment
 * Build sequences of matches, called send array (seq_start,seq_end) to store them
 * Return match score
 *
 * @param {string} a -  string to search
 * @param {string} b - string to be searched
 * @param {Array.<number>} seq_start - store for match start
 * @param {Array.<number>} seq_end - store for match end
 * @param {FuzzySearchOptions=} options
 * @returns {number}
 */

FuzzySearch.align = function (a, b, seq_start, seq_end, options) {

    if (options === undefined) options = FuzzySearch.defaultOptions;

    var wm = 100; // score of making a match
    var wo = -10; // score to open a gap
    var we = -1;  // score to continue an open gap

    //Traceback directions constants
    var STOP = 0;
    var UP = 1;
    var LEFT = 2;
    var DIAGONAL = 3;

    var score_acronym = options.score_acronym;
    var sep_tokens = options.token_sep;

    var m = Math.min(a.length + 1, options.token_query_max_length);
    var n = Math.min(b.length + 1, options.token_field_max_length);

    // Comon prefix is part of lcs,
    // but not necessarily part of best alignment  (it can introduce an extra gap)
    // however prefix  make sens in an autocomplete scenario and speed things up
    //
    var i, j;
    var k = m < n ? m : n;
    var prefix_len = 0;

    if (a === b) {
        //speedup equality
        prefix_len = m;
        m = 0;
    }
    else if (options.highlight_prefix) {
        for (i = 0; i < k && (a[i] === b[i]); i++) prefix_len++;

        if (prefix_len) {
            a = a.substring(prefix_len);
            b = b.substring(prefix_len);

            m -= prefix_len;
            n -= prefix_len;
        }
    }

    var vmax = 0, imax = 0, jmax = 0;
    var trace = new Array(m * n);
    var pos = n - 1;

    //m,n = length+1
    if (m > 1 && n > 1) {


        var vrow = new Array(n), vd, v, align;
        var gapArow = new Array(n), gapA, gapB = 0;

        for (j = 0; j < n; j++) {
            gapArow[j] = 0;
            vrow[j] = 0;
            trace[j] = STOP;
        }

        //DEBUG
        //var DEBUG_V = [];
        //var DEBUG_TR = [];

        for (i = 1; i < m; i++) {

            gapB = 0;
            vd = vrow[0];

            pos++;
            trace[pos] = STOP;

            //DEBUG
            //DEBUG_V[i] = [];
            //DEBUG_TR[i] = [];

            for (j = 1; j < n; j++) {

                //
                // Reference "pseudocode"
                // We try to fill that table, but using o(n) instead o(m*n) memory
                // If we need traceback we still need o(m*n) but we store a single table instead of 3
                //
                // F[i][j] = f =  Math.max(F[i - 1][j] + we, V[i - 1][j] + wo );
                // E[i][j] = e = Math.max(E[i][j - 1] + we, V[i][j - 1] + wo );
                // align = (a[i - 1] === b[j - 1]) ? V[i - 1][j - 1] + wm : -Infinity;
                // V[i][j] = v = Math.max(e, f, align, 0);
                //

                // Score the options
                gapA = gapArow[j] = Math.max(gapArow[j] + we, vrow[j] + wo); //f
                gapB = Math.max(gapB + we, vrow[j - 1] + wo); //e

                if (score_acronym)
                    align = ( a[i - 1] !== b[j - 1] ) ? -Infinity : (
                        vd + wm +
                        ( ( i < 2 || sep_tokens.indexOf(a[i - 2]) > -1 ) ? wm : 0) +
                        ( ( j < 2 || sep_tokens.indexOf(b[j - 2]) > -1 ) ? wm : 0)
                    );
                else
                    align = ( a[i - 1] === b[j - 1] ) ? vd + wm : -Infinity;

                vd = vrow[j];

                v = vrow[j] = Math.max(align, gapA, gapB, 0);

                //DEBUG
                //DEBUG_V[i][j] = v;

                // Determine the trace back direction
                pos++;  //pos = i * n + j;
                switch (v) {

                    // what triggered the best score ?
                    //In case of equality, taking gapB get us closer to the start of the string.
                    case gapB:
                        trace[pos] = LEFT;
                        break;

                    case align:
                        trace[pos] = DIAGONAL;

                        if (v > vmax) {
                            vmax = v;
                            imax = i;
                            jmax = j;
                        }

                        break;


                    case gapA:
                        trace[pos] = UP;
                        break;

                    default:
                        trace[pos] = STOP;
                        break;

                }

                //DEBUG
                //DEBUG_TR[i][j] = trace[pos];

            }
        }


    }

    //DEBUG
    //console.table(DEBUG_V);
    //console.table(DEBUG_TR);


    // - - - - - - - - -
    //     TRACEBACK
    // - - - - - - - - -

    var bridge = options.highlight_bridge_gap;
    var last_match = 0;

    if (vmax > 0) {

        // backtrack to aligned sequence
        // record start and end of substrings
        // vmax happens at the end of last substring

        i = imax;
        j = jmax;
        pos = i * n + j;
        last_match = jmax;
        seq_end.push(jmax + prefix_len);


        var backtrack = true;
        while (backtrack) {

            switch (trace[pos]) {

                case UP:
                    i--;
                    pos -= n;
                    break;

                case LEFT:
                    j--;
                    pos--;
                    break;

                case DIAGONAL:

                    // if we have traversed a gap
                    // record start/end of sequence
                    // (unless we want to bridge the gap)

                    if (last_match - j > bridge) {
                        seq_start.push(last_match + prefix_len);
                        seq_end.push(j + prefix_len);
                    }

                    j--;
                    i--;
                    last_match = j;
                    pos -= n + 1;
                    break;

                case STOP:
                default :
                    backtrack = false;

            }

        }

        //first matched char
        seq_start.push(last_match + prefix_len);

    }


    if (prefix_len) {

        if (last_match > 0 && last_match <= bridge) {

            //bridge last match to prefix ?
            seq_start[seq_start.length - 1] = 0

        } else {

            //add prefix to matches
            seq_start.push(0);
            seq_end.push(prefix_len);

        }

    }

    //array were build backward, reverse to sort
    seq_start.reverse();
    seq_end.reverse();

    return vmax + prefix_len;


};


//
// Each query token is matched against a field token
// or against nothing (not in field)
//
// a: [paint] [my] [wall]
// b: [wall] [painting]
//
// match: [1, -1, 0]
//
// if a[i] match b[j]
//      then match[i] = j
//
// if a[i] match nothing
//      then match[i] = -1
//
// return match score
// take vector match by reference to output match detail
//
// Ideal case:
// each token of "a" is matched against it's highest score(a[i],b[j])
//
// But in case two token have the same best match
// We have to check for another pairing, giving highest score
// under constraint of 1:1 exclusive match
//
// To do that we check all possible pairing permutation,
// but we restrict ourselves to a set of plausible pairing.
//
// That is a token a will only consider pairing with a score at least
//     thresh_relative_to_best * [highest score]
//

/**
 * Match token of A again token of B, under constraint that tokens can be matched at most once.
 *
 * @param {Array.<string>} a_tokens
 * @param {Array.<string>} b_tokens
 * @param {Array.<number>} match - array to store results
 * @param {FuzzySearchOptions=} options
 * @param {boolean=} flip - if true score A against B, but return index of B against A.
 * @returns {number} Score of the best match combination.
 */
FuzzySearch.matchTokens = function (a_tokens, b_tokens, match, options, flip) {

    if (options === undefined) options = FuzzySearch.defaultOptions;
    if (flip === undefined) flip = false;

    var minimum_match = options.minimum_match;
    var best_thresh = options.thresh_relative_to_best;

    var i, j, row;
    var C = [];

    var m = a_tokens.length;
    var n = b_tokens.length;

    var a_maps = FuzzySearch.mapAlphabet(a_tokens);
    var a_tok, b_tok, a_mp;

    var rowmax = minimum_match, imax = -1, jmax = -1, v;
    var match_count = 0;
    var thresholds = [];

    for (i = 0; i < m; i++) {

        row = [];
        match[i] = -1;
        rowmax = minimum_match;

        a_tok = a_tokens[i];
        if (!a_tok.length) {
            //skip score loop but still fill array
            for (j = 0; j < n; j++) row[j] = 0;
            C[i] = row;
            continue;
        }

        a_mp = a_maps[i];

        for (j = 0; j < n; j++) {

            b_tok = b_tokens[j];
            if (!b_tok.length) {
                row[j] = 0;
                continue;
            }

            v = FuzzySearch.score_map(a_tok, b_tok, a_mp, options);
            row[j] = v;

            if (v > minimum_match) match_count++;

            if (v > rowmax) {
                rowmax = v;
                imax = i;
                jmax = j;
            }

        }

        thresholds[i] = rowmax;

        C[i] = row;
    }

    //Shortcut: no match
    if (match_count === 0) return 0;

    //Shortcut: single possible pairing
    if (match_count === 1) {
        match[imax] = jmax;
        if (flip) _flipmatch(match, n);
        return rowmax
    }


    //Only consider matching close enough to best match
    for (i = 0; i < a_tokens.length; i++) {
        thresholds[i] = Math.max(best_thresh * thresholds[i], minimum_match);
    }


    var score = _matchScoreGrid(C, match, thresholds, options.bonus_token_order);

    //Flip back the problem if necessary
    if (flip) _flipmatch(match, n);

    return score;

};

/**
 * Perform the match as FuzzySearch.matchTokens
 * but token against token score is already computed as C
 *
 * This is mostly a preparation phase for _buildScoreTree as well
 * as a post processing traversal to recover the match.
 *
 * @param {Array.<Array.<number>>} C - precomputed score
 * @param {Array.<number>} match - store the position of best matches
 * @param {Array.<number>} thresholds - Information about the minimum score each token is willing to match
 * @param {number} order_bonus
 * @returns {number} - best score
 * @private
 */
function _matchScoreGrid(C, match, thresholds, order_bonus) {

    var i_len = C.length;
    var i, j;

    //Traverse score grid to find best permutation
    var score_tree = [];
    for (i = 0; i < i_len; i++) {
        score_tree[i] = {};
    }

    var opt = new TreeOptions(C, score_tree, thresholds, order_bonus);
    var score = _buildScoreTree(opt, 0, 0).score;

    var used = 0, item;

    for (i = 0; i < i_len; i++) {

        item = score_tree[i][used];
        if (!item) break;
        match[i] = j = item.index;
        if (j > -1) used |= (1 << j);

    }

    return score
}

//
// Cache tree:
//
// Given 5 node: 1,2,3,4,5
//
//  What is the best match ...
//    - knowing that we have passed tru 1->2->3
//    - knowing that we have passed tru 2->3->1
//    - knowing that we have passed tru 3->1->2
//
//  All those question have the same answer
//  because they are equivalent to match {4,5} against {4,5}
// ( in an alternate pass we can match {1,3} against {4,5} for example )
//
// We store match in j in a bit vector of size 32
//
// In addition of saving computation, the cache_tree data structure is used to
// trace back the best permutation !
//
// In addition of quick testing if an item is already used, used_mask serve
// as a key in cache_tree (in addition to level). Ideal key would be a list of available trial
// but, used & available are complementary vector (~not operation) so used is a perfectly valid key too...


/**
 * Branch out to try each permutation of items of A against item of B.
 * - Only try branched not already used.
 * - Prune branch below token threshold.
 * - Build a tree to cache sub-problem for which we already have a solution
 *
 * @param {TreeOptions} tree_opt
 * @param {number} used_mask
 * @param {number} depth
 * @returns {MatchTrial} best_trial
 * @private
 */

function _buildScoreTree(tree_opt, used_mask, depth) {

    var C = tree_opt.score_grid;
    var cache_tree = tree_opt.cache_tree;
    var score_thresholds = tree_opt.score_thresholds;
    var order_bonus = tree_opt.order_bonus;

    var ilen = C.length;
    var jlen = C[depth].length;
    if (jlen > INT_SIZE) jlen = INT_SIZE;

    var j, score;
    var include_thresh = score_thresholds[depth];
    var best_score = 0, best_index = -1;
    var has_child = (depth < ilen - 1);
    var child_tree = cache_tree[depth + 1], child_key;

    for (j = 0; j < jlen; j++) {

        var bit = 1 << j;

        //if token previously used, skip
        if (used_mask & bit) continue;

        //score for this match
        score = C[depth][j];

        //too small of a match, skip
        if (score < include_thresh) continue;

        //score for child match
        //if we already have computed this sub-block get from cache
        if (has_child) {
            child_key = used_mask | bit;

            /** @type MatchTrial */
            var trial = (child_key in  child_tree) ?
                child_tree[child_key] :
                _buildScoreTree(tree_opt, child_key, depth + 1);

            score += trial.score;
            if (j < trial.index) {
                score += order_bonus
            }
        }

        //Because of DFS, first loop that finish is toward the end of the query.
        //As a heuristic, it's good to match higher index toward the end. So we accept equality.
        if (score >= best_score) {
            best_score = score;
            best_index = j;
        }

    }

    //try the move of "do not match this token against anything"
    if (has_child) {

        child_key = used_mask;
        if (child_key in  child_tree) score = child_tree[child_key].score;
        else  score = _buildScoreTree(tree_opt, child_key, depth + 1).score;

        if (score > best_score) {
            best_score = score;
            best_index = -1;
        }

    }

    var best_trial = new MatchTrial(best_score, best_index);
    cache_tree[depth][used_mask] = best_trial;
    return best_trial;

}

/**
 *
 * @param score
 * @param index
 * @constructor
 */
function MatchTrial(score, index) {
    this.score = score;
    this.index = index;
}

/**
 *
 * @param {Array<Array<number>>} score_grid
 * @param {Array<Object<number,MatchTrial>>} cache_tree
 * @param {Array<number>} score_thresholds
 * @param {number} order_bonus
 * @constructor
 */
function TreeOptions(score_grid, cache_tree, score_thresholds, order_bonus) {
    this.score_grid = score_grid;
    this.cache_tree = cache_tree;
    this.score_thresholds = score_thresholds;
    this.order_bonus = order_bonus
}


/**
 * Let A,B be two array
 * Input is an array that map "index of A"->"index of B"
 * Output is the reverse "index of B"->"index of A"
 *
 * Array is modified in place
 *
 * @param {Array.<number>} match - array to remap
 * @param {number} newlen - length of B
 * @private
 */

function _flipmatch(match, newlen) {

    var i, j;
    var ref = match.slice();
    match.length = newlen;

    for (i = 0; i < newlen; i++) {
        match[i] = -1;
    }

    for (i = 0; i < ref.length; i++) {
        j = ref[i];
        if (j > -1 && j < newlen) match[j] = i;
    }

}