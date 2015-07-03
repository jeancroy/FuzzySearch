//
// - - - - - - - - - - - -
//  UI INTEGRATION
// - - - - - - - - - - - -
//

extend(FuzzySearch.prototype, /** @lends {FuzzySearch.prototype} */ {

    /**
     * Return a Debounced version of FuzzySearch.search.
     * New function signature allow to specific callback for different phase of the debounce.
     * De-bounce is adaptative, it will allow short burst and try to learn actual computation time.
     *
     * query: term to search
     * immediate_cb(results) : if search was done without filtering
     * suppress_cb(cached_results) : debounce has supressed the search, return cache of last result
     * finally_cb(results): if at least 1 supression occured, make a new search when debounce end and call this.
     *
     * @returns {function({string}, function({Array}), function({Array}), function({Array}))}
     */
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
        var clock = (window.performance && window.performance.now) ? window.performance : Date;
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

    /**
     * Allow the FuzzySearch object to be given as a source to twitter typeahead.
     * This implement similar interface than Bloodhound object.
     *
     * @returns {function({string}, function({Array}) ,function({Array}) )} Interactive version of search.
     */

    __ttAdapter: function ttAdapter() {

        var debounced = this.getInteractive();
        var noop = function (a) {
        };
        return function (query, sync, async) {
            debounced(query, sync, noop, async);
        }

    },

    /**
     * Generate a function compatible with jQuery UI auto-complete Source
     *
     * @returns {function( {Object}, {function()} )} Interactive version of search.
     */
    $uiSource: function () {

        var debounced = this.getInteractive();
        var noop = function (a) {
        };
        return function (request, response) {
            debounced(request.term, response, noop, response);
        }

    }
});