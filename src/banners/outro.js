//
// Export FuzzySearch
//

if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {

    // CommonJS-like environments
    module.exports = FuzzySearch;

} else if (typeof define === 'function' && define.amd) {

    // AMD. Register as an anonymous module.
    define(function () {
        return FuzzySearch;
    });

} else {

    // Browser globals
    window['FuzzySearch'] = FuzzySearch;

}

return FuzzySearch;

})();