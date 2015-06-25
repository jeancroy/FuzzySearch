/**
 * @license FuzzySearch.js
 * Autocomplete suggestion engine using approximate string matching
 * https://github.com/jeancroy/FuzzySearch
 *
 * Copyright (c) 2015, Jean Christophe Roy
 * Licensed under The MIT License.
 * http://opensource.org/licenses/MIT
 */

(function (global) {
    'use strict';

    function FuzzySearch(options) {
        if (options === undefined) options = {};
        FuzzySearch.setup(this, FuzzySearch.defaultOptions, options)
    }

    FuzzySearch.defaultOptions = {

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
        token_query_max_length: 64,      // Shorten large token to give more even performance.
        token_field_max_length: 64,      // Shorten large token to give more even performance.
        token_fused_max_length: 64,      // Shorten large token to give more even performance.

        //Do not attempt to match token too different in size: n/m = len(field_tok)/len(query_tok)
        token_min_rel_size: 0.6,         // Field token should contain query token. Reject field token that are too small.
        token_max_rel_size: 6,           // Large field token tend to match against everything. Ensure query is long enough to be specific.


        //
        //  Interactive - suggest as you type.
        //  Avoid doing search that will be discarded without being displayed
        //  This also help prevent lag/ temp freeze
        //

        interactive_debounce: 150,   // This is initial value. Will try to learn actual time cost. Set to 0 to disable.
        interactive_mult: 1.2,       // Overhead for variability and to allow other things to happens (like redraw, highlight ).
        interactive_burst: 3,        // Allow short burst, prevent flicker due to debounce suppression of a callback


        //
        //  Default empty source / keys.
        //  Usefull while waiting for ajax download
        //

        source: [],
        index: [],
        keys: [""],
        results: [],

        start_time: 0,
        search_time: 0,

        sorter: null
    };

    /**
     * Number of bit in a int.
     * DEBUG-tip: setting this to zero will force "long string" algorithm for everything!
     * @const
     */
    var INT_SIZE = 32;

    FuzzySearch.setup = function (self, defaults, options) {

        var oSource = self.source;

        // Copy key of options that are also in default
        // If key not in options, add from defaults.
        for (var key in defaults) {
            if (defaults.hasOwnProperty(key)) {
                self[key] = (key in options) ? options[key] : defaults[key];
            }
        }

        if (self.source !== oSource) {
            FuzzySearch.addSource(self, self.source, true);
        }

    };

    FuzzySearch.addSource = function (self, source, overwrite) {

        var nb_items = source.length, out_index;

        if (overwrite) {
            self.index = new Array(nb_items);
            out_index = 0
        } else
            out_index = nb_items;

        var index = self.index;
        var min_size = self.token_field_min_length;
        var max_size = self.token_field_max_length;

        for (var item_index = -1; ++item_index < nb_items;) {

            var item = source[item_index];
            var item_fields = FuzzySearch.generateFields(item, self.keys);

            var nb_fields = item_fields.length;
            var fields = new Array(nb_fields);

            for (var field_index = -1; ++field_index < nb_fields;) {
                fields[field_index] = FuzzySearch.filterSize(FuzzySearch.normalize(item_fields[field_index]).split(" "), min_size, max_size);
            }

            index[out_index++] = new Indexed(item, fields);

        }

        return self;

    };


    //
    // Helper object constructor
    //

    function Query(normalized, tokens_groups, fused_str, fused_map) {
        this.normalized = normalized;
        this.tokens_groups = tokens_groups;
        this.fused_str = fused_str;
        this.fused_score = 0;
        this.fused_map = fused_map;
    }

    function PackInfo(group_tokens, group_map, gate) {
        this.tokens = group_tokens;
        this.map = group_map;
        this.gate = gate;

        var t = group_tokens.length, i = -1;
        var scores = new Array(t);
        while (++i < t) scores[i] = 0;

        this.score_item = scores.slice();
        this.reset = scores;
    }

    function SearchResult(item_score, item, matched_field_index, matched_field_value, sortkey) {
        this.score = item_score;
        this.item = item;
        this.matchIndex = matched_field_index;
        this.match = matched_field_value;
        this.sortKey = sortkey;
    }

    function Indexed(original, fields) {
        this.item = original;
        this.fields = fields;
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

            var opt_bpd = this.bonus_position_decay;
            var opt_fge = this.field_good_enough;
            var opt_trb = this.thresh_relative_to_best;
            var opt_score_tok = this.score_per_token;

            var query = this.query = this._prepQuery(querystring);

            var thresh_include = this.thresh_include;
            var best_item_score = 0;
            var results = [];

            var source = this.index;
            for (var item_index = -1, nb_items = source.length; ++item_index < nb_items;) {

                var item_score = 0;
                var matched_field_index = -1;
                var position_bonus = 1.0;

                //
                //reset best kw score
                //
                var groups = query.tokens_groups;

                for (var group_index = -1, nb_groups = groups.length; ++group_index < nb_groups;) {
                    var grp = groups[group_index];
                    grp.score_item = grp.reset.slice();
                }

                query.fused_score = 0;


                //get indexed fields
                var item = source[item_index];
                var item_fields = item.fields;

                for (var field_index = -1, nb_fields = item_fields.length; ++field_index < nb_fields;) {

                    var field_score;
                    if (opt_score_tok)
                        field_score = this._scoreField(item_fields[field_index], query);
                    else
                        field_score = FuzzySearch.score_map(query.fused_str, item_fields[field_index].join(" "), query.fused_map, this);

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
                    for (group_index = -1; ++group_index < nb_groups;) {
                        var group_scores = groups[group_index].score_item;
                        for (var j = -1, nb_scores = group_scores.length; ++j < nb_scores;) {
                            query_score += group_scores[j]
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

                    item_score = Math.round(item_score / this.score_round) * this.score_round;

                    results.push(new SearchResult(
                        item_score,
                        item.item,
                        matched_field_index,
                        item_fields[matched_field_index].join(" "),
                        item_fields[0].join(" ")
                    ));

                }


            }

            //keep only results that are good enough compared to best
            results = FuzzySearch.filterGTE(results, "score", thresh_include);

            // sort by decreasing order of score
            // equal rounded score: alphabetical order
            if(this.sorter)
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
            var field_score = 0, sc;
            var last_index = -1;

            var bonus_order = this.bonus_token_order;
            var minimum_match = this.minimum_match;


            var token, scores;
            for (var group_index = -1; ++group_index < nb_groups;) {

                var group_info = groups[group_index];

                var best_match_this_field = group_info.reset.slice();
                var best_match_index = group_info.reset.slice();

                var group_tokens = group_info.tokens;
                var nb_scores = group_tokens.length;
                var single = (nb_scores == 1);

                var score_index;
                for (var field_tk_index = -1; ++field_tk_index < nb_tokens;) {

                    token = field_tokens[field_tk_index];

                    if (single) {
                        sc = FuzzySearch.score_map(group_tokens[0], token, group_info.map, this);
                        if (sc > best_match_this_field[0]) {
                            best_match_this_field[0] = sc;
                            best_match_index[0] = field_tk_index;
                        }

                    }
                    else {

                        scores = FuzzySearch.score_pack(group_info, token, this);
                        for (score_index = -1; ++score_index < nb_scores;) {
                            sc = scores[score_index];
                            if (sc > best_match_this_field[score_index]) {
                                best_match_this_field[score_index] = sc;
                                best_match_index[score_index] = field_tk_index;
                            }
                        }

                    }

                }

                var best_match_this_item = group_info.score_item;
                for (score_index = -1; ++score_index < nb_scores;) {

                    sc = best_match_this_field[score_index];
                    field_score += sc;

                    if (sc > best_match_this_item[score_index])
                        best_match_this_item[score_index] = sc;

                    // if search token are ordered inside subject give a bonus
                    // only consider non empty match for bonus
                    if (sc > minimum_match) {
                        var tmp = best_match_index[score_index];
                        if (tmp > last_index) field_score += bonus_order;
                        last_index = tmp;
                    }

                }


            }

            if (this.score_test_fused) {
                // test "space bar is broken" no token match
                var fused_score = FuzzySearch.score_map(query.fused_str, field_tokens.join(" "), query.fused_map, this);
                field_score = fused_score > field_score ? fused_score : field_score;

                if (fused_score > query.fused_score) {
                    query.fused_score = fused_score;
                }
            }


            return field_score;

        },

        _prepQuery: function (querystring) {

            var norm_query = FuzzySearch.normalize(querystring);
            var query_tokens = FuzzySearch.filterSize(norm_query.split(" "), this.token_query_min_length, this.token_query_max_length);
            var fused = norm_query.substring(0, this.token_fused_max_length);

            return new Query(
                norm_query,
                FuzzySearch.pack_tokens(query_tokens),
                fused,
                (this.score_test_fused || !this.score_per_token) ? FuzzySearch.alphabet(fused) : {}
            )

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
            var count = 0, suppressed = false;

            return function (query, immediate_cb, suppress_cb, finally_cb) {

                var later = function () {
                    timeout = null;
                    if (suppressed) {
                        cache = self.search(query);
                        finally_cb(cache);
                    }
                    count = 0;
                    suppressed = false;
                };

                clearTimeout(timeout);
                timeout = setTimeout(later, wait);

                if (++count < burst) {

                    suppressed = false;
                    var before = clock.now();
                    cache = self.search(query);
                    var ret = immediate_cb(cache);
                    var now = clock.now();

                    //try to learn  typical time (time mult factor);
                    wait = 0.5 * wait + 0.5 * mult * (now - before);
                    //console.log(wait);
                    return ret;

                } else {
                    suppressed = true;
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

    /**
     * this is default sort function
     */

    FuzzySearch.compareResults = FuzzySearch.defaultOptions.sorter = function (a, b) {
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
                for (i = -1; ++i < olen;) {
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
                for (i = -1; ++i < olen;) {
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

    FuzzySearch.mapField = function (source, path, max_out) {

        var n = source.length;
        if (max_out > 0 && max_out < n) n = max_out;
        if (path == "") return source.slice(0, n);

        var out = new Array(n);
        var obj, i;

        if (path.indexOf(".") === -1) {
            //fast case no inner loop
            for (i = -1;++i < n;) {
                obj = source[i];
                if (path in obj) out[i] = obj[path];
            }

        } else {

            //general case
            var parts = path.split(".");
            var nb_level = parts.length;

            for (i=-1;++i < n;) {
                obj = source[i];

                for ( var level = -1;++level < nb_level;) {
                    var key = parts[level];
                    if (!(key in obj)) break;
                    obj = obj[key];
                }

                out[i] = obj;
            }

        }

    };

    FuzzySearch.filterGTE = function (array, field, compareto) {
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


    //-----------------------------
    //       SCORING FUNCTIONS
    // ---------------------------


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

        if (options === undefined) options = FuzzySearch.defaultOptions;
        var aMap = FuzzySearch.alphabet(a);

        return FuzzySearch.score_map(a, b, aMap, options);

    };

    // Main score function for single item
    FuzzySearch.score_map = function (a, b, aMap, options) {

        var j, lcs_len;
        var m = a.length;
        var n = b.length;
        var bonus_prefix = options.bonus_match_start;

        var k = m < n ? m : n;
        if (k === 0 || n < options.token_min_rel_size * m || n > options.token_max_rel_size * m) return 0;

        //normalize score against length of both inputs
        var sz_score = (m + n) / ( 2.0 * m * n);

        //common prefix is part of lcs
        var prefix = 0;
        if (a === b) prefix = k; //speedup equality
        else {
            while ((a[prefix] === b[prefix]) && (++prefix < k));
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

    // Apply above score function for a list of parralel query
    // ZM gard the independent scoring
    FuzzySearch.score_pack = function (packinfo, field_token, options) {

        var packed_tokens = packinfo.tokens;
        var nb_packed = packed_tokens.length;

        var S = 0xFFFFFFFF, U, c;
        var ZM = packinfo.gate | 0;
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
                while ((query_tok[prefix] === field_token[prefix]) && (++prefix < p));
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
    // Prepare query for search
    //

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

    FuzzySearch.alphabet = function (token) {
        var len = token.length;
        if (len > INT_SIZE) return FuzzySearch.posVector(token);
        else return FuzzySearch.bitVector(token, {}, 0);
    };

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

    function Block(start, end) {
        this.start = start;
        this.end = end;
    }

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
            last_line = [new Block(0, prefix), new Block(Infinity, Infinity)];
        else
            last_line = [new Block(Infinity, Infinity)];

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
                block_start = block.start; //Encode block as [s,e[
                block_end = block.end; //End is position of char that follow last.
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

            //last_line.length = 0;
            last_line = current_line;

            //console.log(JSON.stringify(last_line));
            //console.log(lcs_len)

        }

        return lcs_len;

    };

    // Export to Common JS Loader
    if (typeof exports === 'object') {
        // CommonJS-like environments
        module.exports = FuzzySearch;
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(function() {
            return FuzzySearch;
        });
    } else {
        // Browser globals (root is window)
        global.FuzzySearch = FuzzySearch;
    }

    return FuzzySearch;

})(this);

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