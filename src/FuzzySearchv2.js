/**
 * @license FuzzySearch.js
 * Autocomplete suggestion engine using approximate string matching
 * https://github.com/jeancroy/FuzzySearch
 *
 * Copyright (c) 2015, Jean Christophe Roy
 * Licensed under The MIT License.
 * http://opensource.org/licenses/MIT
 */


//
// Search a query across multiple item
//
// Each item has one or multiple fields.
// Query is split into tokens (words)
// Field are split into tokens.
//
// Query can match using free word order
// "paint my wall" -> "wall painting"
// (bonus is given for proper word order)
//
// Query can match across diferent field
// "Davinci Brown" -> item.title = "davinci code", item.author="dawn brown"
// (score is better for match in the same field)
//
// Score take field position into account.
// For example one can give preference to title over author
// Author over keyword1, keyword1 over keyword 2 and so on.
// (Position bonus fade exponentially so bonus between 1 and 2
// is far greater than bonus between 21 and 22)
//


var FuzzySearch = (function () {
    'use strict';

    var _defaults = {

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

        score_test_fused: true,           // Try one extra match where we disregard token separation.
                                          // "oldman" match "old man"

        //
        //  Output sort & transform
        //

        score_round: 0.1,                // Two item that have the same rounded score are sorted alphabetically
        recover_match: false,            // Recover original spelling of field that has matched (before normalisation)
        output_limit: 0,                 // Return up to N result, 0 to disable
        output_map: "",                  // Transform the output.
                                         // output_map="" return inner working object {score:...,item:...,match:..., matchIndex:...}
                                         // output_map="item" return original object. output_map="item.this.that" output a field of object.

        //
        //  Tokens options
        //

        token_query_min_length: 2,       // Avoid processing very small words, include greater or equal, in query
        token_field_min_length: 3,       // include greater or equal, in item field
        token_query_max_length: 64,      // Shorten large token to give more predictive performance.
        token_field_max_length: 64,      // Shorten large token to give more predictive performance.
        token_fused_max_length: 64,      // Shorten large token to give more predictive performance.

        // len(field_tok)/len(query_tok) = n/m
        token_min_rel_size: 0.6,         // Field token should contain query token. Reject field token that are too small.
        token_max_rel_size: 6,           // Large field token tend to match against everything. Ensure query is long enough to be specific.

        max_search_tokens: 10,           // Because of free word order, each search token add cost equivalent to one traversal
                                         // additional tokens are lumped as a nth+1 token

        cache_fields: true,              // Collect values and normalise only once.
                                         // This will duplicate indexed field in memory.

        //
        //  Interractive - suggest as you type.
        //  Avoid doing search that will be discarded without being displayed
        //  This also help prevent lag/ temp freeze
        //

        interactive_debounce: 150,   // This is initial value. Will try to learn actual time cost. Set to 0 to disable.
        interactive_mult: 1.2,       // Overhead for variability and to allow other things to happens (like redraw, highlight ).
        interactive_burst: 3,        // Allow short burst, prevent flicker due to debounce supress


        //
        //  Highlight
        //

        highlight_prefix: false,         // true: force prefix as part of highlight, (false: minimum gap, slower)
        highlight_bridge_gap: 2,         // display small gap as substitution, set to size of gap, 0 to disable
        highlight_before: '<strong class="highlight">',  //tag to put before/after the highlight
        highlight_after: '</strong>',

        //
        //  Default empty source / keys.
        //  Usefull while waiting for ajax download
        //

        source: [],
        keys: [""],
        results: [],

        sorter: function(){}

    };

    //
    // Size of text we can procedd in a single int
    //
    var INT_SIZE = 32;

    function FuzzySearch(options) {
        if (options === undefined) options = {};
        FuzzySearch.setup(this, _defaults, options)
    }

    FuzzySearch.defaultOptions = _defaults;

    FuzzySearch.setup = function (item, defaults, options) {

        // Copy key of options that are also in default
        // If key not in options, add from defaults.
        for (var key in defaults) {
            if (defaults.hasOwnProperty(key)) {
                item[key] = (key in options) ? options[key] : defaults[key];
            }
        }

    };


    //Helper on array
    function _map(array, transform, context) {
        var i = -1;
        var n = array.length;
        var out = new Array(n);

        while (++i < n) {
            out[i] = transform.call(context, array[i], i, array);
        }
        return out;
    }


    FuzzySearch.prototype = {

        //Allow to overwrite some options, keeping previous intact.
        set: function (options) {
            if (options === undefined) options = {};
            FuzzySearch.setup(this, this, options);
        },

        search: function (querystring) {

            var clock = (window.performance && window.performance.now) ? window.performance : Date;

            var time_start = clock.now();
            this.start_time = time_start;

            var query = this.query = this._prepQuery(querystring);
            var thresh_include = this.thresh_include;
            var best_item_score = 0;
            var results = [];

            var source_index = -1, source_len = this.source.length;

            var opt_bpd = this.bonus_position_decay;
            var opt_fge = this.field_good_enough;
            var opt_trb = this.thresh_relative_to_best;
            var opt_score_tok = this.score_per_token;

            while (++source_index < source_len) {

                var item_score = 0;
                var matched_field_index = -1;
                var position_bonus = 1.0;

                //
                //reset best kw score
                var groups = query.tokens_groups;
                var nbgroups = groups.length;

                var i=-1;
                while (++i < nbgroups) {
                    var gi = groups[i];
                    gi.score_item = gi.reset.slice();
                }

                query.fused_score = 0;


                //get indexed fields
                var item = this.source[source_index];
                var item_fields = this._getFields(item);

                var field_index = -1, fields_len = item_fields.length;
                while (++field_index < fields_len) {

                    var field_score;
                    if (opt_score_tok)
                        field_score = this._scoreField(item_fields[field_index], query);
                    else
                        field_score = FuzzySearch.score_map(query.normalized, item_fields[field_index].join(" "), query.fused_map, this);

                    field_score *= (1.0 + position_bonus);
                    position_bonus *= opt_bpd;

                    if (field_score > item_score) {
                        item_score = field_score;
                        matched_field_index = field_index;

                        if (field_score > opt_fge) break;
                    }

                }


                if (opt_score_tok) {

                    var query_score = 0;
                    i = -1;
                    while (++i < nbgroups) {
                        var v = groups[i].score_item;
                        var j = -1, vlen =  v.length;
                        while ( ++j < vlen) {
                            query_score += v[j]
                        }
                    }

                    if (query.fused_score > query_score) query_score = query.fused_score;
                    item_score = 0.5 * item_score + 0.5 * query_score;

                }

                // get stat of the best result so far
                // this control inclusion of result in final list
                if (item_score > best_item_score) {
                    best_item_score = item_score;
                    var tmp = item_score * opt_trb;
                    if (tmp > thresh_include) thresh_include = tmp;
                }

                //candidate for best result ? push to list
                if (item_score > thresh_include) {
                    results.push(this._prepResult(item, item_score, matched_field_index));
                }


            }

            //keep only results that are good enough compared to best
            results = FuzzySearch.filterGT(results, "score", thresh_include);

            // sort by decreasing order of score
            // equal rounded score: alphabetical order
            results = results.sort(this.sorter);

            if (this.output_map.length || this.output_limit > 0) {
                results = FuzzySearch.mapField(results, this.output_map, this.output_limit);
            }

            var time_end = clock.now();
            this.search_time = time_end - time_start;
            this.results = results;

            return results
        },

        _scoreField: function (field_tokens, query) {

            var groups = query.tokens_groups;
            var nb_groups = groups.length;
            var nb_tokens = field_tokens.length;
            var field_score = 0;
            var group_index = -1, sc;
            var last_index = -1;

            var bonus_order = this.bonus_token_order;
            var minimum_match = this.minimum_match;


            var token, scores;

            while (++group_index < nb_groups) {

                var group_info = groups[group_index];

                var best_match_this_field = group_info.reset.slice();
                var best_match_index = group_info.reset.slice();

                var group_tokens = group_info.tokens;
                var nb_scores = group_tokens.length;
                var single = (nb_scores==1);
                var best = 0;

                var field_tk_index = -1, score_index;
                while (++field_tk_index < nb_tokens) {

                    token = field_tokens[field_tk_index];

                    if(single){
                        sc = FuzzySearch.score_map(group_tokens[0], token, group_info.map ,this );
                        if (sc > best_match_this_field[0]) {
                            best_match_this_field[0] = sc;
                            best_match_index[0] = field_tk_index;
                        }

                    }
                    else{

                        scores = FuzzySearch.score_pack(group_info, token, this);
                        score_index = -1;
                        while (++score_index < nb_scores) {
                            sc = scores[score_index];
                            if (sc > best_match_this_field[score_index]) {
                                best_match_this_field[score_index] = sc;
                                best_match_index[score_index] = field_tk_index;
                            }
                        }

                    }

                }

                var best_match_this_item = group_info.score_item;

                score_index = -1;
                while (++score_index < nb_scores) {

                    sc = best_match_this_field[score_index];
                    field_score += sc;

                    if (sc > best_match_this_item[score_index])
                        best_match_this_item[score_index] = sc;

                    // if search token are ordered inside subject give a bonus
                    // only consider non empty match for bonus
                    if (sc > minimum_match) {
                        var tmp = best_match_index[score_index];
                        if( tmp > last_index ) field_score += bonus_order;
                        last_index = tmp;
                    }

                }


            }

            if(this.score_test_fused){
                // test "space bar is broken" no token match
                var fused_score = FuzzySearch.score_map(query.normalized, field_tokens.join(" "), query.fused_map, this);
                field_score = fused_score > field_score ? fused_score : field_score;

                if (fused_score > query.fused_score) {
                    query.fused_score = fused_score;
                }
            }


            return field_score;

        },

        _getFields: function (item) {

            if (this.cache_fields && item._fields_) return item._fields_;

            var min_size =  this.token_field_min_length;
            var max_size = this.token_field_max_length;

            var item_fields = FuzzySearch.generateFields(item, this.keys);

            var nb_fields = item_fields.length, i = -1;
            var fields = new Array(nb_fields);

            while(++i<nb_fields){
                fields[i] = FuzzySearch.filterSize(FuzzySearch.normalize(item_fields[i]).split(" "),min_size,max_size);
            }

            if (this.cache_fields) item._fields_ = fields;

            return fields;
        },


        _prepQuery: function (querystring) {

            var norm_query = FuzzySearch.normalize(querystring);
            var query_tokens = FuzzySearch.filterSize(norm_query.split(" "), this.token_query_min_length, this.token_query_max_length);

            // lump tokens after max_search_tokens
            // if only one extra, it's already lumped
            var maxtksz = this.max_search_tokens;
            if (query_tokens.length > maxtksz + 1) {
                query_tokens.push(query_tokens.splice(maxtksz).join(" ").substring(0,this.token_query_max_length));
            }

            var fused = norm_query.substring(0,this.token_fused_max_length);

            return {
                normalized: norm_query,
                tokens_groups: this._pack_tokens(query_tokens),
                fused_str:fused,
                fused_score: 0,
                fused_map: (this.score_test_fused || !this.score_per_token)?FuzzySearch.bitVector(fused):{}
            };

        },

        _pack_tokens: function (tokens) {

            var token_index = -1;
            var nb_tokens = tokens.length;
            var large;
            var groups=[];

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

                    if( l >= 32){

                        large = {
                                tokens: [token],
                                map: FuzzySearch.posVector(token),
                                gate: 0xFFFFFFFF,
                                score_item: [0],
                                reset:[0]
                            };

                        break;

                    }
                    else if (l + offset >= 32) {
                        token_index--;
                        break;
                    }
                    else{
                        group_tokens.push(token);
                        gate |= FuzzySearch.packedVector(token, group_map, offset);
                        offset += l
                    }

                }

                var t = group_tokens.length, i = -1;

                if(t>0){
                    var scores = new Array(t);
                    while (++i < t) scores[i] = 0;

                    groups.push({
                        "tokens": group_tokens,
                        "map": group_map,
                        "gate": gate,
                        score_item: scores.slice(),
                        reset: scores
                    });
                }

                if(large){
                    groups.push(large);
                    large = null;
                }

            }

            return groups;

        },

        _prepResult: function (item, item_score, matched_field_index) {

            var matched = "", sk, f;

            if (this.recover_match) {
                f = FuzzySearch.generateFields(item, this.keys);
                matched = f[matched_field_index] || "";
            }

            //sorting by string without accent make the most sens
            if (this.cache_fields)
                sk = item._fields_[0].join(" ");
            else
                sk = FuzzySearch.normalize(f ? f[0] : FuzzySearch.getField(item, this.keys[0]));

            item_score = Math.round(item_score / this.score_round) * this.score_round;

            return {
                score: item_score,
                item: item,
                "matchIndex": matched_field_index,
                "match": matched,
                "sortKey": sk
            }


        },

        //Get a Debounced version of search method with callbacks

        getInteractive: function () {

            var self = this;
            var wait = this.interactive_debounce;
            var mult = this.interactive_mult;
            var burst = this.interactive_burst;

            // Debounce off
            if (wait === 0) {
                return (function (query, immediate_cb, suppress_cb, finally_cb) {
                    return immediate_cb(self.search(query))
                })
            }

            // Debounce
            var clock = (performance && performance.now) ? performance : Date;
            var timeout, cache;
            var count = 0, supressed = false;

            var later = function (query, callback) {
                timeout = null;
                if (supressed) {
                    cache = self.search(query);
                    callback(cache);
                }
                count = 0;
                supressed = false;
            };

            return function (query, immediate_cb, suppress_cb, finally_cb) {

                clearTimeout(timeout);
                timeout = setTimeout(later, wait, query, finally_cb);

                if (++count < burst) {

                    supressed = false;
                    var before = clock.now();
                    cache = self.search(query);
                    var ret = immediate_cb(cache);
                    var now = clock.now();

                    //try to learn  typical time (time mult factor);
                    wait = 0.5 * wait + 0.5 * mult * (now - before);
                    //console.log(wait);
                    return ret;

                } else {
                    supressed = true;
                    //console.log("supress");
                    return suppress_cb(cache);
                }
            }

        },


        __ttAdapter: function ttAdapter() {

            var debounced = this.getInteractive();
            var noop = function (a) {
            };
            return function (query, sync, async) {
                debounced(query, sync, noop, async);
            }

        }


    };


    // replace most common accents in french-spanish by their base letter
    //"ãàáäâæẽèéëêìíïîõòóöôœùúüûñç"
    var from = "\xE3\xE0\xE1\xE4\xE2\xE6\u1EBD\xE8\xE9\xEB\xEA\xEC\xED\xEF\xEE\xF5\xF2\xF3\xF6\xF4\u0153\xF9\xFA\xFC\xFB\xF1\xE7";
    var to = "aaaaaaeeeeeiiiioooooouuuunc";
    var diacriticsMap = {};
    for (var i = 0; i < from.length; i++) {
        diacriticsMap[from[i]] = to[i]
    }

    FuzzySearch.normalize = function (str) {
        if (!str)return "";
        return str.toLowerCase().replace(/\s+/g, " ").replace(/[^\u0000-\u007E]/g, function (a) {
            return diacriticsMap[a] || a;
        });
    };

    FuzzySearch.compareResults = _defaults.sorter = function(a,b) {
        var d = b.score - a.score;
        if (d !== 0) return d;
        var ak = a.sortKey, bk = b.sortKey;
        return ak > bk ? 1 : ( ak < bk ? -1 : 0);
    };

    FuzzySearch.generateFields = function (obj, fieldlist) {

        if (!fieldlist.length) return [obj.toString()];

        var indexed_fields = [];
        for (var i = 0; i < fieldlist.length; i++) {
            FuzzySearch._collectValues(obj, fieldlist[i].split("."), indexed_fields, 0)
        }
        return indexed_fields;

    };

    FuzzySearch.getField = function (obj, field) {

        if (!field.length) return obj.toString();

        var indexed_fields = [];
        FuzzySearch._collectValues(obj, field.split("."), indexed_fields, 0);
        return indexed_fields[0] || "";

    };

    FuzzySearch._collectValues = function (obj, parts, list, level) {

        var key, i, olen;
        var nb_level = parts.length;
        while (level < nb_level) {

            key = parts[level];
            if (key === "*") break;
            if (!(key in obj)) return list;
            obj = obj[key];
            level++

        }

        var type = Object.prototype.toString.call(obj);
        var isArray = ( type === '[object Array]'  );
        var isObject = ( type === '[object Object]' );


        if (level === nb_level) {

            if (isArray) {
                olen = obj.length;
                i = -1;
                while (++i < olen) {
                    list.push(obj[i].toString())
                }
            }

            else if (isObject) {
                for (key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        list.push(obj[key].toString())
                    }
                }
            }

            else list.push(obj.toString());

        }

        else if (key === "*") {

            level++;
            if (isArray) {
                olen = obj.length;
                i = -1;
                while (++i < olen) {
                    FuzzySearch._collectValues(obj[i], parts, list, level);
                }
            }
            else if (isObject) {
                for (key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        FuzzySearch._collectValues(obj[key], parts, list, level);
                    }
                }
            }

        }

        return list;
    };

    FuzzySearch.filterSize = function (array, minSize, maxSize) {
        var i = -1, j = -1;
        var n = array.length;
        var out = [];
        var str, slen;

        while (++i < n) {
            str = array[i];
            slen = str.length;
            if (slen >= minSize) {
                if (slen < maxSize)
                    out[++j] = str;
                else
                    out[++j] = str.substr(0, maxSize)
            }
        }
        return out;
    };

    FuzzySearch.mapField = function (source, path, limit) {

        var n = source.length;
        if (limit > 0 && limit < n) n = limit;
        if (path == "") return source.slice(0, n);

        var out = new Array(n);
        var i = -1;
        var obj;

        if (path.indexOf(".") === -1) {

            //fast case no inner loop
            while (++i < n) {
                obj = source[i];
                if (path in obj) out[i] = obj[path];
            }

        } else {

            //genaral case
            var parts = path.split(".");
            var nb_level = parts.length;
            obj = source[i];

            while (++i < n) {
                var level = -1;
                while (++level < nb_level) {
                    var key = parts[level];
                    if (!(key in obj)) break;
                    obj = obj[key];
                }

                out[i] = obj;
            }

        }

    };

    FuzzySearch.filterGT = function (array, field, compareto) {

        var i = -1, j = -1;
        var n = array.length;
        var out = [], obj;

        while (++i < n) {
            obj = array[i];
            if (obj[field] >= compareto) {
                out[++j] = obj;
            }
        }

        return out;
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

    FuzzySearch.prototype.score = function (a, b) {
        return FuzzySearch.score(a, b, this)
    };

    FuzzySearch.score = function (a, b, options) {

        if (options === undefined) options = _defaults;
        var aMap = FuzzySearch.bitVector(a);

        return FuzzySearch.score_map(a, b, aMap, options);

    };

    // Main score function
    // This one do not check for input
    FuzzySearch.score_map = function (a, b, aMap, options) {

        var i, j, lcs_len;
        var m = a.length;
        var n = b.length;
        var bonus_prefix = options.bonus_match_start;

        var k = m < n ? m : n;
        if( k === 0 ||  n < options.token_min_rel_size*m || n > options.token_max_rel_size*m ) return 0;

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

    FuzzySearch.score_pack = function (packinfo, field_token, options) {

        var packed_tokens = packinfo.tokens;
        var nb_packed = packed_tokens.length;

        var S = 0xFFFFFFFF, U, c;
        var ZM = packinfo.gate|0;
        var aMap = packinfo.map;

        var n = field_token.length, j = -1;

        while (++j < n) {
            c = field_token[j];
            if (c in aMap) {
                U = S & aMap[c];
                S = ( (S & ZM) + (U & ZM) ) | (S - U);
            }
        }

        S = ~S;

        var k = -1;
        var offset = 0;
        var bonus_prefix = options.bonus_match_start;
        var min_rs = options.token_min_rel_size;
        var max_rs = options.token_max_rel_size;
        var scores = new Array(nb_packed);

        while (++k < nb_packed) {

            var query_tok = packed_tokens[k];
            var m = query_tok.length;
            var i = -1, lcs_len, prefix;

            if(  n < min_rs*m || n > max_rs*m ){
                scores[k] =0;
                offset += m;
                continue;
            }

            if (query_tok === field_token)
                prefix = lcs_len = m;
            else {
                var p = (m < n) ? m : n;
                prefix = 0;
                while ( (query_tok[prefix] === field_token[prefix]) && (++prefix < p)) {}
                var Sm = ( (S >>> offset) &  ( (1 << m) - 1 ) ) >>> prefix;
                lcs_len = prefix;
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

    FuzzySearch.bitVector = function (token) {

        var map = {};
        var len = token.length;

        //Large string, fallback to position by position algorithm
        if (len > INT_SIZE) return FuzzySearch.posVector(token);

        var i = -1, c;
        while (++i < len) {
            c = token[i];
            if (c in map) map[c] |= (1 << i);
            else map[c] = (1 << i);
        }

        return map;
    };

    //
    // Like above bitvector but allow multiple token to be packed together.
    // Do not automatically branch to large search
    // Return mask to gate carry bit
    //

    FuzzySearch.packedVector = function (token, map, offset) {

        var len = token.length;
        var i = -1, c;
        var b = offset;

        while (++i < len) {
            c = token[i];
            if (c in map) map[c] |= (1 << b++);
            else map[c] = (1 << b++);
        }

        //Return mask of length with msb set to 0
        return ( (1 << (len - 1) ) - 1 ) << offset

    };


    //
    // Similar as bitvector but position is recorded as an integer in an array
    // instead of a bit in an integer
    //

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

    //
    // Compute LLCS, using vector of position.
    //
    // Based on:
    // An input sensitive online algorithm for LCS computation
    // Heikki Hyyro 2009
    //
    // We fill the dynamic programing table line per line
    // but instead of storing the whole line we only store position where the line increase
    // ( bitvector algorythm store increase yes/no as a bit) this time we will store sequence
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
        var last_line, current_line, line_index, last_end, block_end;
        if (prefix === undefined) prefix = 0;

        if (prefix)
            last_line = [[0, prefix], [Infinity, Infinity]];
        else
            last_line = [[Infinity, Infinity]];

        var lcs_len = prefix;

        var match_list, match_index;
        var block, block_index, block_size;

        var n = b.length, j;
        for (j = prefix; j < n; j++) {

            //Each line we process a single character of b
            var c = b[j];
            if (!(c in aMap)) continue;
            match_list = aMap[c];

            //New line
            current_line = [];
            line_index = -1;

            //First match
            match_index = 0;
            match_pos = match_list[0];

            //Place first block before the string
            block_end = -1;
            block_index = -1;

            var nblock = last_line.length;
            while (++block_index < nblock) {

                //Place cursor just after last block
                last_end = block_end;

                //Read end block
                block = last_line[block_index];
                block_start = block[0]; //Encode block as [s,e[
                block_end = block[1]; //End is position of char that follow last.
                block_size = block_end - block_start;

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
                    current_line[line_index][1]++;
                }
                else {

                    //Increase need it's own block ( step a.i)
                    //try to reuse block that will get deleted.
                    if (block_size === 1) {
                        //Can we reuse next block ?
                        block[0] = match_pos;
                        block[1] = match_pos + 1;
                        current_line[++line_index] = block;
                    } else {
                        //start a new block
                        current_line[++line_index] = [match_pos, match_pos + 1];
                    }

                }

                // if not empty, append next block to current line (step a.iii)
                // (this condition reject "sentinel", it'll get added just after the for loop)
                if (block_size > 1) {
                    block[0]++; // Move start by one
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

            //last_line.length = 0;
            last_line = current_line;

            //console.log(JSON.stringify(last_line));
            //console.log(lcs_len)

        }

        return lcs_len;

    };

    FuzzySearch.prototype.highlight = function (b) {
        return FuzzySearch.highlight(this.query.normalized, b, this)
    };

    FuzzySearch.highlight = function (a, b, options) {

        if (options === undefined) options = _defaults;
        if (!b) return "";

        //var time_start = performance.now();

        var open_string = options.highlight_before;
        var close_string = options.highlight_after;
        var opt_score_tok = options.score_per_token;
        var opt_fuse = options.score_test_fused;

        var aa = FuzzySearch.normalize(a);
        var bb = FuzzySearch.normalize(b);

        var a_tokens = aa.split(" ");
        var b_tokens = bb.split(" ");
        var disp_tokens = b.split(/\s+/);

        // enforce maximum number of token in a
        // after max, token are lumped together a big one
        var nb_max_tokens = options.max_search_tokens;
        if (a_tokens.length > nb_max_tokens + 1) {
            var extra = a_tokens.splice(nb_max_tokens).join(" ");
            a_tokens.push(extra);
        }

        var strArr = [];
        var match_list = [];
        var fused_score=0, match_score=0;

        if (opt_score_tok) {
            match_score = FuzzySearch.matchTokens(a_tokens,b_tokens, match_list, options,true);
            if (match_score === 0) return b; //shortcut no match
            //Test "spacebar is broken" no token match
            if(opt_fuse) fused_score = FuzzySearch.score(aa, bb, options);
        }

        if (!opt_score_tok ||  fused_score > match_score) {
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

        //var time_end = performance.now();
        //console.log("Highlight took " + (time_end-time_start) + " milliseconds.");

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

    FuzzySearch.align = function (a, b, seq_start, seq_end, options) {

        if (options === undefined) options = _defaults;

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


    FuzzySearch.matchTokens = function (a_tokens, b_tokens, match, options, flip) {

        if (options === undefined) options = _defaults;

        var minimum_match = options.minimum_match;
        var best_thresh = options.thresh_relative_to_best;

        var i, j, row;
        var C = [];

        var m = a_tokens.length;
        var n = b_tokens.length;

        //
        // to minimise recursion depth, "a" should be smaller than "b"
        // we can flip the problem if we believe we can save enough
        // to justify to cost of flipping it back at the end
        //

        if(flip==undefined) flip = false;
        if (m > 1 && n > 1 && m - n > 10) {
            //switch a, b
            var tmp = a_tokens;
            a_tokens = b_tokens;
            b_tokens = tmp;
            i = m;
            m = n;
            n = i;
            flip = !flip;
        }


        var a_maps = _map(a_tokens, FuzzySearch.bitVector);
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
            if (flip) FuzzySearch._flipmatch(match, n);
            return rowmax
        }


        //Only consider matching close enough to best match
        for (i = 0; i < a_tokens.length; i++) {
            thresholds[i] = Math.max(best_thresh * thresholds[i], minimum_match);
        }


        var score = FuzzySearch._matchScoreGrid(C, match, thresholds);

        //Flip back the problem if necessary
        if (flip) FuzzySearch._flipmatch(match, n);

        return score;

    };

    FuzzySearch._matchScoreGrid = function (C, match, thresholds) {

        var ilen = C.length;
        var i, j;

        //Traverse score grid to find best permutation
        var scoretree = [];
        for (i = 0; i < ilen; i++) {
            scoretree[i] = {};
        }

        var score = FuzzySearch._buildScoreTree(C, scoretree, 0, 0, thresholds);

        var used = 0, item;

        for (i = 0; i < ilen; i++) {

            item = scoretree[i][used];
            if (!item) break;
            j = item[1];
            match[i] = j;
            if (j > -1) used |= (1 << j);

        }


        return score
    };

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

    FuzzySearch._buildScoreTree = function (C, cache_tree, used_mask, depth, score_thresholds) {

        var ilen = C.length;
        var jlen = C[depth].length;
        if (jlen > 32) jlen = 32;

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
                if (child_key in  child_tree) score += child_tree[child_key][0];
                else score += FuzzySearch._buildScoreTree(C, cache_tree, child_key, depth + 1, score_thresholds);
            }

            if (score > best_score) {
                best_score = score;
                best_index = j;
            }

        }

        //try the move of "do not match this token against anything"
        if (has_child) {

            child_key = used_mask;
            if (child_key in  child_tree) score = child_tree[child_key][0];
            else  score = FuzzySearch._buildScoreTree(C, cache_tree, child_key, depth + 1, score_thresholds);

            if (score > best_score) {
                best_score = score;
                best_index = -1;
            }

        }


        cache_tree[depth][used_mask] = [best_score, best_index];
        return best_score;


    };


    FuzzySearch._flipmatch = function (match, newlen) {

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

    };


    //
    // Identify
    // Use to compare bloodhound, get unique set etc
    //

    // 32 bit FNV-1a hash
    // Ref.: http://isthe.com/chongo/tech/comp/fnv/
    function fnv32a(str) {
        var hash = 0x811c9dc5;
        for (var i = 0; i < str.length; ++i) {
            hash ^= str.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return hash >>> 0;
    }

    FuzzySearch.identify = function (item, keys) {
        var str;

        var type = Object.prototype.toString.call(keys);

        if (!keys || !keys.length)
            str = JSON.stringify(item);
        else if (type === '[object String]')
            str = FuzzySearch.getField(item, keys);
        else if (type === '[object Array]')
            str = FuzzySearch.generateFields(item, keys).join('¬');
        else
            str = JSON.stringify(item);

        return fnv32a(str);

    };


    return FuzzySearch;

})();

//
// Reference implementation to debug
// Might need to swap input to match internal of a given algorithm
//


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
}