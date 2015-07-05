//
//-----------------------------
//       SCORING FUNCTIONS
// ---------------------------
//

/**
 * Score of "search a in b" using self as options.
 * @param  {string} a
 * @param {string} b
 */
FuzzySearch.prototype.score = function (a, b) {
    var aMap = FuzzySearch.alphabet(a);
    return FuzzySearch.score_map(a, b, aMap, this.options);
};

// Adapted from paper:
// A fast and practical bit-vector algorithm for
// the Longest Common Subsequence problem
// Maxime Crochemore et Al.
//
// With modification from
// Bit-parallel LCS-length computation revisited (H Hyyrö, 2004)
// http://www.sis.uta.fi/~hh56766/pubs/awoca04.pdf
//

/**
 * Score of "search a in b" using precomputed alphabet map
 * Main algorithm for single query token to score
 *
 * @param {string} a
 * @param {string} b
 * @param {Object} aMap - See FuzzySearch.alphabet
 * @param {FuzzySearchOptions} options
 */
FuzzySearch.score_map = function (a, b, aMap, options) {

    var j, lcs_len;
    var m = a.length;
    var n = b.length;
    var bonus_prefix = options.bonus_match_start;

    var k = m < n ? m : n;
    if (k === 0) return 0;

    //normalize score against length of both inputs
    var sz_score = (m + n) / ( 2.0 * m * n);

    //common prefix is part of lcs
    var prefix = 0;
    if (a === b) prefix = k; //speedup equality
    else {
        while ((a[prefix] === b[prefix]) && (++prefix < k)) {
        }
    }

    //shortest string consumed
    if (prefix === k) {
        lcs_len = prefix;
        return sz_score * lcs_len * lcs_len + bonus_prefix * prefix;
    }

    //alternative algorithm for large string
    //need to keep this condition in sync with bitvector
    if (m > INT_SIZE) {
        lcs_len = FuzzySearch.llcs_large(a, b, aMap, prefix);
        return sz_score * lcs_len * lcs_len + bonus_prefix * prefix;
    }

    var mask = ( 1 << m ) - 1;
    var S = mask, U, c;

    j = prefix - 1;
    while (++j < n) {
        c = b[j];
        if (c in aMap) {
            // Hyyrö, 2004 S=V'=~V
            U = S & aMap[c];
            S = (S + U) | (S - U);
        }
    }

    // Remove match already accounted in prefix region.
    mask &= ~( ( 1 << prefix ) - 1 );

    // lcs_len is number of 0 in S (at position lower than m)
    // inverse S, mask it, then do "popcount" operation on 32bit
    S = ~S & mask;

    S = S - ((S >> 1) & 0x55555555);
    S = (S & 0x33333333) + ((S >> 2) & 0x33333333);
    lcs_len = (((S + (S >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;

    lcs_len += prefix;
    return sz_score * lcs_len * lcs_len + bonus_prefix * prefix;

};

/**
 * Call score_map on the first token.
 * Filter size
 *
 * @param {PackInfo} packinfo
 * @param {string} token
 * @param {FuzzySearchOptions} options
 * @return {number} score
 */
FuzzySearch.score_single = function (packinfo, token, options) {
    var field_tok = packinfo.tokens[0];
    var m = field_tok.length;
    var n = token.length;
    if (n < options.token_min_rel_size * m || n > options.token_max_rel_size * m) return 0;
    return FuzzySearch.score_map(field_tok, token, packinfo.map, options)
};

/**
 * Score multiple query token against a single field token.
 * Apply above score function in parallel
 * Computation is done as if everything was one big token,
 * but ZM bit-vector modify boundary so score are independant
 *
 * @param {PackInfo} packinfo
 * @param {string} field_token
 * @param {FuzzySearchOptions} options
 * @returns {Array.<number>} scores
 */
FuzzySearch.score_pack = function (packinfo, field_token, options) {

    var packed_tokens = packinfo.tokens;
    var nb_packed = packed_tokens.length;

    var S = 0xFFFFFFFF, U, c;
    var ZM = packinfo.gate | 0;
    var aMap = packinfo.map;

    for (var j = -1, n = field_token.length; ++j < n;) {
        c = field_token[j];
        if (c in aMap) {
            U = S & aMap[c];
            S = ( (S & ZM) + (U & ZM) ) | (S - U);
        }
    }

    S = ~S;

    var bonus_prefix = options.bonus_match_start;
    var min_rs = options.token_min_rel_size;
    var max_rs = options.token_max_rel_size;
    var scores = new Array(nb_packed);
    var offset = 0;

    for (var k = -1; ++k < nb_packed;) {

        var query_tok = packed_tokens[k];
        var m = query_tok.length;
        var lcs_len, prefix;

        if (n < min_rs * m || n > max_rs * m) {
            scores[k] = 0;
            offset += m;
            continue;
        }

        if (query_tok === field_token)
            prefix = lcs_len = m;

        else {
            var p = (m < n) ? m : n;
            prefix = 0;
            while ((query_tok[prefix] === field_token[prefix]) && (++prefix < p)) {
            }
            lcs_len = prefix;
            var Sm = ( (S >>> offset) & ( (1 << m) - 1 ) ) >>> prefix;
            while (Sm) {
                Sm &= Sm - 1;
                lcs_len++
            }
        }

        offset += m;
        var sz = (m + n) / ( 2.0 * m * n);
        scores[k] = sz * lcs_len * lcs_len + bonus_prefix * prefix;

    }

    return scores;

};


//
// Compute LLCS, using vectors of position.
//
// Based on:
// An input sensitive online algorithm for LCS computation
// Heikki Hyyro 2009
//
// We fill the dynamic programing table line per line
// but instead of storing the whole line we only store position where the line increase
// ( bitvector algorithm store increase yes/no as a bit) this time we will store sequence
//
//    s u r g e r y
// g [0,0,0,1,1,1,1] : [3,4] (Add level 1)
// s [1,1,1,1,1,1,1] : [0,1] (Make level 1 happens sooner)
// u [1,2,2,2,2,2,2] : [0,2] (Add level 2, append to block of consecutive increase)
// r [1,2,3,3,3,3,3] : [0,3] (Add level 3, append to block of consecutive increase)
// v [1,2,3,3,3,3,3] : [0,3] (v not in surgery, copy)
// e [1,2,3,3,4,4,4] : [0,3],[4,5] (Add level 4, create new block for it)
// y [1,2,3,3,4,4,5] : [0,3],[4,5],[6,7] (Add level 5, create new block for it)
//
// There is 2 Basic operations:
// - Make a level-up happens sooner
// - Add an extra level up at the end. (this is where llcs increase !)
//
//  12345678901234567890  // Position (for this demo we start at 1)
//  ii------iii---i--i--  // Increase point of previous line
//  12222222345555666777  // Score previous line [1,3] [9,12] [15,16] [18,19]
//  ---m-m---------m---m  // Match of this line
//  12233333345555677778  // Score of this line [1,3] [4,5] [10,12] [15,17] [20,21]
//  ii-i-----ii---ii---i  // New increase point
//  12345678901234567890  // Position


FuzzySearch.llcs_large = function (a, b, aMap, prefix) {

    //var aMap = FuzzySearch.posVector(a);

    //Position of next interest point. Interest point are either
    // - Increase in previous line
    // - Match on this line
    var block_start, match_pos;

    // We encode increase sequence as [start_pos, end_pos+1]
    // So end-start = length

    // To avoid dealing with to many edge case we place
    // a special token at start & end of list
    var last_line, line_index, last_end, block_end;
    if (prefix === undefined) prefix = 0;

    if (prefix)
        last_line = [new Block(0, prefix), new Block(Infinity, Infinity)];
    else
        last_line = [new Block(Infinity, Infinity)];

    var lcs_len = prefix;

    var match_list, match_index;
    var block, block_index, block_size;

    //First line
    var nb_blocks = last_line.length;

    var n = b.length, j;
    for (j = prefix; j < n; j++) {

        //Each line we process a single character of b
        var c = b[j];
        if (!(c in aMap)) continue;
        match_list = aMap[c];

        //New line
        // the number of if block can only increase up to llcs+1+sentinel
        // alternatively each block having >1 item can split. (+1 at end accounted by splitting sentinel)
        /** @type Array.<Block> */
        var current_line = new Array(Math.min(2 * nb_blocks, lcs_len + 2));
        line_index = -1;

        //First match
        match_index = 0;
        match_pos = match_list[0];

        //Place end of first block before the string
        block_end = -1;
        block_index = -1;


        while (++block_index < nb_blocks) {

            //Place cursor just after last block
            last_end = block_end;

            //Read end block
            block = last_line[block_index];
            block_start = block.start; //Encode block as [s,e[
            block_end = block.end; //End is position of char that follow last.
            block_size = block_end - block_start; //Size of block,  for sentinel (Inf-Inf=NaN)

            //get next match from list of matches
            while (match_pos < last_end) {
                match_pos = match_list[++match_index];
            }

            // This cover two case
            // a) no match between two block
            // b) block happens after last match (so match_pos=Infinity).
            //    At the last block, this will append closing "sentinel" to line
            if (block_start <= match_pos) {
                current_line[++line_index] = block;
                continue;
            }

            //
            // If we have reached here, we have a dominant match !
            // Decide where to register the match ...
            //

            if (match_pos === last_end) {
                //End of last block ? (step a.ii)
                current_line[line_index].end++;
            }
            else {

                //Increase need it's own block ( step a.i)
                //try to reuse block that will get deleted.
                if (block_size === 1) {
                    //Can we reuse next block ?
                    block.start = match_pos;
                    block.end = match_pos + 1;
                    current_line[++line_index] = block;
                } else {
                    //start a new block
                    current_line[++line_index] = new Block(match_pos, match_pos + 1);
                }

            }

            // if not empty, append next block to current line (step a.iii)
            // (this condition reject "sentinel", it'll get added just after the for loop)
            if (block_size > 1) {
                block.start++; // Move start by one
                current_line[++line_index] = block;
            }

        }

        // If the line finish with a match:
        //  a) llcs at end of this line is one greater than last line, increase score
        //  b) we still need to append sentinel
        if (block_start > match_pos) {
            current_line[++line_index] = block;
            lcs_len++
        }


        //Current become last
        last_line = current_line;

        //Count actual number of block because we allocate a bit more.
        nb_blocks = ++line_index;


    }

    return lcs_len;

};

/**
 * A block with start and end position
 * Used to record consecutive increase position in llcs_large
 * @param start
 * @param end
 * @constructor
 */
function Block(start, end) {
    this.start = start;
    this.end = end;
}

//
// Reference implementation to debug
// Might need to swap input to match internal of a given algorithm
//

/*
 function lcs(a, b) {

 var m = a.length;
 var n = b.length;
 var i, j;

 //init m by n array  with 0
 var C = [], row = [], lcs = [];
 for (j = 0; j < n; j++) row[j] = 0;
 for (i = 0; i < m; i++) C[i] = row.slice();

 //fill first row and col
 C[0][0] = (a[0] === b[0]) ? 1 : 0;
 for (i = 1; i < m; i++) C[i][0] = (a[i] === b[0] || C[i - 1][0]) ? 1 : 0
 for (j = 1; j < n; j++) C[0][j] = (a[0] === b[j] || C[0][j - 1]) ? 1 : 0
 console.log(JSON.stringify(C[0]));

 //bulk
 for (i = 1; i < m; i++) {
 for (j = 1; j < n; j++) {
 C[i][j] = (a[i] === b[j]) ? C[i - 1][j - 1] + 1 : Math.max(C[i][j - 1], C[i - 1][j]);
 }
 console.log(JSON.stringify(C[i]));
 }

 //backtrack
 i--;
 j--;
 while (i > -1 && j > -1) {
 if (i && C[i][j] == C[i - 1][j])  i--;
 else if (j && C[i][j] == C[i][j - 1]) j--;
 else {
 lcs.push(a[i]);
 j--;
 i--;
 }
 }

 return lcs.reverse().join('');
 }*/