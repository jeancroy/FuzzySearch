/**
 * @license Highlight.FuzzySearch.js
 * Highlight plugin for FuzzySearch
 * https://github.com/jeancroy/FuzzySearch
 *
 * Copyright (c) 2015, Jean Christophe Roy
 * Licensed under The MIT License.
 * http://opensource.org/licenses/MIT
 */


(function () {

    var FuzzySearch;

    if (typeof require === 'function') {
        FuzzySearch = require("FuzzySearch")
    } else {
        FuzzySearch = window["FuzzySearch"];
    }

    /**@const*/
    var INT_SIZE = 32;

    /** @lends {FuzzySearch.prototype} */
    var highlightOptions = {

        highlight_prefix: false,         // true: force prefix as part of highlight, (false: minimum gap, slower)
        highlight_bridge_gap: 2,         // display small gap as substitution, set to size of gap, 0 to disable
        highlight_before: '<strong class="highlight">',  //tag to put before/after the highlight
        highlight_after: '</strong>'

    };

    //
    // Extend base option to support highlight
    //
    var defaults = FuzzySearch.defaultOptions;

    for (var key in highlightOptions) {
        if (highlightOptions.hasOwnProperty(key)) {
            defaults[key] = highlightOptions[key];
        }
    }

    /**
     * Highlight a string using query stored in a FuzzySearch object.
     * @param {String} str
     */
    FuzzySearch.prototype.highlight = function (str) {
        return FuzzySearch.highlight(this.query.normalized, str, this)
    };

    /**
     * Highlight string b, from searching a in it.
     *
     * @param {String} a - string to search
     * @param {String} b - string to highlight
     * @param {FuzzySearch=} options
     *
     */
    FuzzySearch.highlight = function (a, b, options) {

        if (options === undefined) options = FuzzySearch.defaultOptions;
        if (!b) return "";

        var open_string = options.highlight_before;
        var close_string = options.highlight_after;
        var opt_score_tok = options.score_per_token;
        var opt_fuse = options.score_test_fused;

        var aa = FuzzySearch.normalize(a);
        var bb = FuzzySearch.normalize(b);

        var a_tokens = aa.split(" ");
        var b_tokens = bb.split(" ");
        var disp_tokens = b.split(/\s+/);

        var strArr = [];
        var match_list = [];
        var fused_score = 0, match_score = 0;

        if (opt_score_tok) {
            match_score = FuzzySearch.matchTokens(a_tokens, b_tokens, match_list, options, true);
        }

        //Test "spacebar is broken" no token match
        if (opt_fuse || !opt_score_tok) fused_score = FuzzySearch.score_map(aa, bb, FuzzySearch.alphabet(aa), options);

        if (match_score === 0 && fused_score===0) return b; //shortcut no match


        if (!opt_score_tok || fused_score > match_score) {
            a_tokens = [aa]; //everything in a single token
            b_tokens = [bb];
            disp_tokens = [disp_tokens.join(" ")];
            match_list = [0];
        }

        var nbtok = disp_tokens.length, j = -1;
        while (++j < nbtok) {

            var i = match_list[j];

            if (i === -1) {
                strArr.push(disp_tokens[j] + " ");
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

            strArr.push(td.substring(curr) + " ");

        }

        return strArr.join('');

    };


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
     * @param {String} a -  string to search
     * @param {String} b - string to be searched
     * @param {Number[]} seq_start - store for match start
     * @param {Number[]} seq_end - store for match end
     * @param {FuzzySearch=} options
     * @returns {number}
     */

    FuzzySearch.align = function (a, b, seq_start, seq_end, options) {

        if (options === undefined) options = FuzzySearch.defaultOptions;

        var wm = 1.0;   // score to making a match
        var wo = -0.1;  // score to open a gap
        var we = -0.01; // score to continue an open gap

        var STOP = 0; //Traceback direction constant
        var UP = 1;
        var LEFT = 2;
        var DIAGONAL = 3;

        var m = Math.min(a.length + 1, options.token_query_max_length);
        var n = Math.min(b.length + 1, options.token_field_max_length);

        // Comon prefix is part of lcs,
        // but not necessarily part of best alignment  (it can introduce an extra gap)
        // however prefix  make sens in an autocomplete scenario and speed things up
        //
        var i, j;
        var k = m < n ? m : n;
        var prefixlen = 0;

        if (a === b) {
            //speedup equality
            prefixlen = m;
            m = 0;
        }
        else if (options.highlight_prefix) {
            for (i = 0; i < k && (a[i] === b[i]); i++) prefixlen++;

            if (prefixlen) {
                a = a.substring(prefixlen);
                b = b.substring(prefixlen);

                m -= prefixlen;
                n -= prefixlen;
            }
        }

        var vmax = 0, imax = 0, jmax = 0;

        var traceback = new Array(m * n);
        var pos = n - 1;

        //m,n = length+1
        if (m > 1 && n > 1) {


            var vrow = new Array(n), vd, v, align;
            var gapArow = new Array(n), gapA, gapB = 0;

            for (j = 0; j < n; j++) {
                gapArow[j] = 0;
                vrow[j] = 0;
                traceback[j] = STOP;
            }

            for (i = 1; i < m; i++) {

                gapB = 0;
                vd = vrow[0];

                pos++;
                traceback[pos] = STOP;

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
                    align = ( a[i - 1] === b[j - 1] ) ? vd + wm : -Infinity;
                    vd = vrow[j];

                    v = vrow[j] = Math.max(align, gapA, gapB, 0);

                    // Determine the traceback direction
                    pos++;  //pos = i * n + j;
                    switch (v) {

                        // what triggered the best score ?

                        case align:
                            traceback[pos] = DIAGONAL;

                            if (v > vmax) {
                                vmax = v;
                                imax = i;
                                jmax = j;
                            }

                            break;

                        case gapB:
                            traceback[pos] = LEFT;
                            break;

                        case gapA:
                            traceback[pos] = UP;
                            break;

                        default:
                            traceback[pos] = STOP;
                            break;

                    }


                }
            }


        }

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
            seq_end.push(jmax + prefixlen);


            var backtrack = true;
            while (backtrack) {

                switch (traceback[pos]) {

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
                            seq_start.push(last_match + prefixlen);
                            seq_end.push(j + prefixlen);
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
            seq_start.push(last_match + prefixlen);

        }


        if (prefixlen) {

            if (last_match > 0 && last_match <= bridge) {

                //bridge last match to prefix ?
                seq_start[seq_start.length - 1] = 0

            } else {

                //add prefix to matches
                seq_start.push(0);
                seq_end.push(prefixlen);

            }

        }

        //array were build backward, reverse to sort
        seq_start.reverse();
        seq_end.reverse();

        return vmax + prefixlen;


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
     * @param {String[]} a_tokens
     * @param {String[]} b_tokens
     * @param {Number[]} match - array to store results
     * @param {FuzzySearch=} options
     * @param {Boolean=} flip - if true score A against B, but return index of B against A.
     * @returns {Number} Score of the best match combination.
     */
    FuzzySearch.matchTokens = function (a_tokens, b_tokens, match, options, flip) {

        if (options === undefined) options = FuzzySearch.defaultOptions;
        if (flip == undefined) flip = false;

        var minimum_match = options.minimum_match;
        var best_thresh = options.thresh_relative_to_best;

        var i, j, row;
        var C = [];

        var m = a_tokens.length;
        var n = b_tokens.length;

        var a_maps = FuzzySearch.mapAlphabet(a_tokens);
        var a_tok, b_tok, a_mp;

        var rowmax = minimum_match, imax = -1, jmax = -1, v;
        var matchcount = 0;
        var thresholds = [];

        for (i = 0; i < m; i++) {

            row = [];
            match[i] = -1;
            rowmax = minimum_match;

            a_tok = a_tokens[i];
            if (!a_tok.length) continue;

            a_mp = a_maps[i];

            for (j = 0; j < n; j++) {

                b_tok = b_tokens[j];
                if (!b_tok.length) continue;

                v = FuzzySearch.score_map(a_tok, b_tok, a_mp, options);
                row[j] = v;

                if (v > minimum_match) matchcount++;

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
        if (matchcount === 0) return 0;

        //Shortcut: single possible pairing
        if (matchcount === 1) {
            match[imax] = jmax;
            if (flip) _flipmatch(match, n);
            return rowmax
        }


        //Only consider matching close enough to best match
        for (i = 0; i < a_tokens.length; i++) {
            thresholds[i] = Math.max(best_thresh * thresholds[i], minimum_match);
        }


        var score = _matchScoreGrid(C, match, thresholds);

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
     * @param {Number[][]} C - precomputed score
     * @param {Number[]} match - store the position of best matches
     * @param thresholds - Information about the minimum score each token is willing to match
     * @returns {Number} - best score
     * @private
     */
    function _matchScoreGrid(C, match, thresholds) {

        var ilen = C.length;
        var i, j;

        //Traverse score grid to find best permutation
        var score_tree = [];
        for (i = 0; i < ilen; i++) {
            score_tree[i] = {};
        }

        var score = _buildScoreTree(C, score_tree, 0, 0, thresholds);

        var used = 0, item;

        for (i = 0; i < ilen; i++) {

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
    //    - knowing that we have passed thru 1->2->3
    //    - knowing that we have passed thru 2->3->1
    //    - knowing that we have passed thru 3->1->2
    //
    //  All those question have the same answer
    //  because they are equivalent to match {4,5} againt {4,5}
    // ( in an alternate pass we can match {1,3} againt {4,5} for example )
    //
    // We store match in j in a bit vector of size 32
    //
    // In addition of saving computation, the cache_tree data structure is used to
    // trace back the best permutation !
    //
    // In addition of quick testing if an item is already used, used_mask serve
    // as a key in cache_tree (in addition to level). Ideal key would be a list of available trial
    // but, used & available are complementary vector (~not operation) so used is a perfeclty valid key too...


    /**
     * Branch out to try each permutation of items of A against item of B.
     * - Only try branched not already used.
     * - Prune branch below token threshold.
     * - Build a tree to cache sub-problem for which we already have a solution
     *
     * @param {Number[][]} C
     * @param {Object[]} cache_tree
     * @param {Number} used_mask
     * @param {Number} depth
     * @param {Number} score_thresholds
     * @returns {number} score
     * @private
     */
    function _buildScoreTree(C, cache_tree, used_mask, depth, score_thresholds) {

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
                if (child_key in  child_tree) score += child_tree[child_key].score;
                else score += _buildScoreTree(C, cache_tree, child_key, depth + 1, score_thresholds);
            }

            if (score > best_score) {
                best_score = score;
                best_index = j;
            }

        }

        //try the move of "do not match this token against anything"
        if (has_child) {

            child_key = used_mask;
            if (child_key in  child_tree) score = child_tree[child_key].score;
            else  score = _buildScoreTree(C, cache_tree, child_key, depth + 1, score_thresholds);

            if (score > best_score) {
                best_score = score;
                best_index = -1;
            }

        }

        cache_tree[depth][used_mask] = new MatchTryout(best_score, best_index);
        return best_score;

    }

    /**
     *
     * @param score
     * @param index
     * @constructor
     */
    function MatchTryout(score, index) {
        this.score = score;
        this.index = index;
    }

    /**
     * Let A,B be two array
     * Input is an array that map "index of A"->"index of B"
     * Output is the reverse "index of B"->"index of A"
     *
     * Array is modified in place
     *
     * @param {Number[]} match - array to remap
     * @param {Number} newlen - length of B
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

})();