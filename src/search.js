// main entry of the algorithm (once settings are set)
// loop over everything and merge best scores
'use strict';

extend(FuzzySearch.prototype, /** @lends {FuzzySearch.prototype} */ {

    /**
     * Perform a search on the already indexed source.
     *
     * @param {string} query_string
     * @returns {Array}
     */
    search: function (query_string) {

        var clock = (window.performance && window.performance.now) ? window.performance : Date;
        var time_start = clock.now();
        this.start_time = time_start;
        var options = this.options;

        // As long as lazy is set to false, we guarantee that making a search is read only.
        if (this.dirty && options.lazy) {
            this._buildIndexFromSource();
            this.dirty = false;
        }

        var query = this.query = this._prepQuery(query_string);
        var source = this.index;
        var results = [];

        if (options.filter) {
            source = options.filter.call(this, source);
        }

        // ---- MAIN SEARCH LOOP ---- //
        var thresh_include = this._searchIndex(query, source, results);

        //keep only results that are good enough compared to best
        results = FuzzySearch.filterGTE(results, "score", thresh_include);

        // sort by decreasing order of score
        // equal rounded score: alphabetical order
        if (typeof options.sorter === "function")
            results = results.sort(options.sorter);

        if (options.output_map || options.output_limit > 0) {
            if (typeof options.output_map === "function")
                results = FuzzySearch.map(results, options.output_map, this, options.output_limit);
            else
                results = FuzzySearch.mapField(results, options.output_map, options.output_limit);
        }

        var time_end = clock.now();
        this.search_time = time_end - time_start;
        this.results = results;

        return results

    },


    /**
     * Main search loop for a specified source
     * This separation allow to search a different source, or a subset of source
     *
     * @param {Query} query
     * @param {Array.<Indexed>} source
     * @param {Array.<SearchResult>} results
     * @returns {number} - thresh_include after this run.
     *
     * @private
     */

    _searchIndex: function (query, source, results) {

        var options = this.options;
        var opt_bpd = options.bonus_position_decay;
        var opt_fge = options.field_good_enough;
        var opt_trb = options.thresh_relative_to_best;
        var opt_max_inners = options.max_inners;
        var opt_score_tok = options.score_per_token;
        var opt_round = options.score_round;
        var thresh_include = options.thresh_include;

        var best_item_score = 0;

        var sub_query = query.children;

        for (var item_index = -1, nb_items = source.length; ++item_index < nb_items;) {

            //get indexed fields
            var item = source[item_index];
            var item_fields = item.fields;

            //reset score
            query.resetItem();

            var item_score = 0;
            var matched_field_index = -1;
            var matched_node_index = -1;
            var position_bonus = 1.0;

            //
            //Foreach field
            //

            for (var field_index = -1, nb_fields = item_fields.length; ++field_index < nb_fields;) {

                var field_score = 0;
                var field_node = -1;
                var field = item_fields[field_index];

                var child_query = sub_query[field_index]; //tag search
                var tagged = !!child_query;

                for (var node_index = -1, nb_nodes = field.length; ++node_index < nb_nodes;) {
                    var node_score, node = field[node_index];

                    if (opt_score_tok) {
                        node_score = this._scoreField(node, query);
                        if (tagged) node_score += this._scoreField(node, child_query);//tag search
                    }
                    else
                        node_score = FuzzySearch.score_map(query.fused_str, node.join(" "), query.fused_map, options);

                    if (node_score > field_score) {
                        field_score = node_score;
                        field_node = node_index;
                    }
                }

                field_score *= (1.0 + position_bonus);
                position_bonus *= opt_bpd;

                if (field_score > item_score) {
                    item_score = field_score;
                    matched_field_index = field_index;
                    matched_node_index = field_node;

                    if (field_score > opt_fge) break;
                }

            }

            //
            // Different query token match different fields ?
            //

            if (opt_score_tok) {

                var query_score = query.scoreItem();
                item_score = 0.5 * item_score + 0.5 * query_score;

            }

            //
            // Keep track of best result, this control inclusion in the list
            //

            if (item_score > best_item_score) {
                best_item_score = item_score;
                var tmp = item_score * opt_trb;
                if (tmp > thresh_include) thresh_include = tmp;
            }

            //
            //candidate for best result ? push to list
            //

            var max_inners_reached = (opt_max_inners && opt_max_inners <= results.length);
            if (max_inners_reached) break;

            if (item_score > thresh_include) {
                item_score = Math.round(item_score / opt_round) * opt_round;

                results.push(new SearchResult(
                    item.item,
                    item_fields,
                    item_score,
                    matched_field_index,
                    matched_node_index,
                    item_fields[0][0].join(" ")
                ));
            }

        }

        return thresh_include
    },

    /**
     * Internal loop that is run for each field in an item
     *
     * @param {Array} field_tokens
     * @param {Query} query
     * @returns {number}
     * @private
     */

    _scoreField: function (field_tokens, query) {

        var groups = query.tokens_groups;
        var nb_groups = groups.length;
        var nb_tokens = field_tokens.length;
        if (!nb_groups || !nb_tokens) return 0;

        var field_score = 0, sc, bf;
        var last_index = -1;
        var options = this.options;

        var bonus_order = options.bonus_token_order;
        var minimum_match = options.minimum_match;

        var token, scores, i;
        for (var group_index = -1; ++group_index < nb_groups;) {

            var group_info = groups[group_index];
            var nb_scores = group_info.tokens.length;

            // Each packinfo have their own reusable scratch pad
            // to store best score information, reset them to 0

            var best_of_field = group_info.score_field;
            for (i = -1; ++i < nb_scores;) best_of_field[i] = 0

            var best_index = group_info.field_pos;
            for (i = -1; ++i < nb_scores;) best_index[i] = 0

            for (var field_tk_index = -1; ++field_tk_index < nb_tokens;) {

                token = field_tokens[field_tk_index];
                scores = FuzzySearch.score_pack(group_info, token, options);
                for (i = -1; ++i < nb_scores;) {
                    sc = scores[i];
                    bf = best_of_field[i];
                    //Score is an improvement OR
                    //Score is within a token order bonus from being better, but word are swapped

                    if (sc > bf || ( bf - sc < bonus_order && i > 0 && best_index[i] <= best_index[i - 1] )) {
                        best_of_field[i] = sc;
                        best_index[i] = field_tk_index;
                    }

                }

            }

            var best_match_this_item = group_info.score_item;
            for (i = -1; ++i < nb_scores;) {

                sc = best_of_field[i];
                field_score += sc;


                // Give bonus for pair in consecutive order
                // Only consider positive match for bonus
                if (sc > minimum_match) {
                    var this_index = best_index[i];

                    //Bonus is diluted by the distance between words.
                    //Positive match, but out of order get half the bonus.
                    var d = this_index - last_index;
                    var bo = bonus_order * ( 1.0 / (1.0 + Math.abs(d)));
                    if (d > 0) bo *= 2;
                    field_score += bo;
                    sc += bo;
                    last_index = this_index;
                }

                if (sc > best_match_this_item[i])
                    best_match_this_item[i] = sc;

            }


        }

        if (options.score_test_fused) {

            // field_tokens.join(" "), remove last one if acronym
            // performance of array.join(" ") and str concat look similar on modern browser.

            var n = (options.score_acronym) ? nb_tokens - 1 : nb_tokens;
            var fused_field = field_tokens[0], fi = 0;
            while (++fi < n) fused_field += " " + field_tokens[fi];

            // test "space bar is broken" no token match
            var fused_score = FuzzySearch.score_map(query.fused_str, fused_field, query.fused_map, options);
            fused_score += bonus_order; //fused cannot be out of order
            field_score = fused_score > field_score ? fused_score : field_score;

            if (fused_score > query.fused_score) {
                query.fused_score = fused_score;
            }
        }


        return field_score;

    }
});


