Fuzzymatch.js
=====================

What is fuzzymatch.js ?
-----------------------

It is an approximate string matching library with focus on search and especially suggest-as-you-type autocomplete.
The suggestion engine is complatible with twitter typeahead and can be used instead of a bloodhound object.
This library / suggestion engine do not have nay dependency. It is also focused on string processing and will not do ajax call by itself.

It perform three kind of operation:

1. Searching

    Perform the scoring operation on all item keyword.
    Manage logic of why an item would have a better overall score than another given multiple axproximately matched keyword

2. Scoring

    Given two word how clore are they ? Is word A closer to B or to C ? Is Match(A,B) worth less or more than Match(C,D) ?
    We try to answer those question in an autcomplete scenario. Error in what is already typed probably worth more than a character not yet typed.
    This would not be the case in a spellchecker setup for example.


2. Highlighting

    Highlight is provided on demand. First best 1:1 pairing between query and field tokens is computed.
    Then we compute matching characters between the two tokens, taking special care to output the most compact
    match when multiple one are possible.



Basic usage
=====================

Minimalist
----------

Basic usage is to create an object that specify the data and keys to be indexed
Then use the method search to perform a search

    var data = ["survey","surgery","insurgence"];
    var searcher = new FuzzyMatch({source:data, output_map:"item"});
    var query = "assurance";
    var result = searcher.search(query)

Twiter typeahead
----------------

Fuzzymatch support the __ttAdapter interface so it can be used instead of a BloodHound object.
Setting no output filter output an abject with all match detail (score, matched field, original item)
highlight is provided on demand, here we use it at template construction time

    var books = [{"title":"First Book", "author":"John Doe"}, {"title":"...", "author":"..."}];
    var fuzzyhound = new FuzzyMatch({source:data, keys:["title","author"], output_map:"" });

    $('#typeahead-input').typeahead({ minLength: 2 }, {
        name: 'fuzzyhound',
        source: fuzzyhound,
        display: "item.title",
        templates: {
            suggestion: function (suggestion) {
                var item = suggestion.item;
                var query = suggestion._query;
                return [
                    "<div>",
                    "<span class='title'>", fuzzyhound.highlight(query, item.title), "</span>|",
                    "<span class='author'>", fuzzyhound.highlight(query, item.author), "</span><br>",
                    "<span class='score'>( ", suggestion.match, " : ", suggestion.score.toFixed(2), " )</span>",
                    "</div>"

                ].join("");
            },
            notFound: function (context) {
                return "<div class='typeahead-empty'> No result for \"" + context.query + "\"</div>"
            }
        }


    }



Scoring overview
=====================

General principle is to be very flexible in finding a match, prefer return a loose match than nothing, but give higher score when we do not need the flexibility (more exact match)

Scoring an item
----------------

FuzzyMatch suport quite complex items, query is compared to specified field.

    book = {
        Title: "Cliché à Paris, The",
        Year: 1977,
        Author: "John MiddleName Doe",
        Keywords:["Story","Boy"],
        Reference:{ISSN:"00-11-22", ARK:"AA-BB-CC"},
        Available:4
    }

### Collect informations (And normalise)

> keys = ["Title","Author","Year","Keywords","Reference.ISSN"]

First thing we do is to build a list of field value, normalised to lowercase and with some common accent removed. If field is an array all it's sub elements are inserted. Values are inserted for a key value map.
We support path (things.this.that).

> Fields = ["cliche a paris, the","john middlename noe","1977","story","boy","00-11-22"]

### Item priority

It often make send to give more weigth to the title than first keyword,
more weigth to first keyword than second and so on.

Bonus is exponentialy deaying. This is it give a marked difference betwen first and secodn item and not so much item 4th going on. 

With (bonus_position_decay=0.5)  we have this: 
bonus = 1+0.5^n

|Position | 0   | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8    |
|---------|-----|-----|-----|-----|-----|-----|-----|-----|------|
|Bonus    | 2.0 | 1.5 | 1.25| 1.13| 1.06| 1.03| 1.02| 1.01| 1.003|


### Free word order

Often words keep their meaning even when out of order.
Those will all match the author keyword:

    John Doe
    Doe John
    John doe Midle

Another example where free word order is useful woud be natural language query:

>How to paint my wall ?

Match: 

>Wall painting 101

Flipside of alowing free word order is prefering properly ordered words. This is done by giving a bonus of (bonus_token_order) each time two consecutive token in the query are in order in the match

### Multiple field matching

> cliche 1977

This query would match in both title and year field.
Flipside of alowing Multiple field matching is giving preference to words in the same field:

 >"john doe", two word, same field

Score is average of
 1. best score, every query token on the best field for the item
 2. best score, every query token on any field (their best field)

### Output score thresholding

Default value are for suggestion as you type.
In this case we prefer to show poor matches than nothing, match will improve as we type more.

> Parameter thresh_include control the minimum score to show

We also want to limit choices to a good match or a few good matches if those exist.
For example if the best score is twice as good as the next best one, it's obviously the candidate to show.

> Parameter thresh_relative_to_best control ratio of best match needed to be shown on the list

Lastly if an item have multiple keyword, we migth want to stop searching once we have found a good keyword.
If a match is this good it'll be shown, no matter the best treshold.

> Parameter field_good_enough control the score needed to stop the search on this item.
> It also control forced inclusion, not matter best



### Output map

Internaly we work on object like

    candidate = {
        score:8.1,
        item:{},
        match:"1977",
        matchIndex:2
    }

Disabling output mapping will get you this object.
Note that there's extra processing for recovering the match value.

> outputmap="item"

Will give you your original item

> outputmap="item.Title"

Will give you a list of title.



Scoring a token (in a autocomplete friendly maner)
--------------------------------------------------

There'is two main way to count string similarity one is to count the number of matches
the other one is to count the number of error. Those refer to the length of the
longest comon subsequence and the edit distance problem.
(Here we'll consider only the simple edit distance with only insertion/deletion )

Macth are show with "|" and error are show with "-"

    match:
    sur-ve-y
    |||  | |
    surg-ery

match: 5, error: 3


Both are related, but when comparing score of different length they can lead to different conclusions.

    For example:
    match("uni","university") : match 3, error 7
    match("uni","hi") : match 1, error 2

First pairing have more match, second pairing have less error.
Most algorythm available use edit distance (error)
yet somehow uni -> university is a intuitive match.

### Looking at realtive errors

One way to deal with different match length is to normalize by the length
Let's try to compare error count with length of second term...

    Second still have less error
    7 error/10 char = 0,7 error/char
    2 error/3 char = 0,666 error/char

even worse, on relative error, they are very close...

    match("uni","universit") 6 error 9 char, 0,666 error/char
    match("uni","universi") 5 error 8 char, 0,625 error/char
    (pairing decision is now reversed at this point if we apply relative scoring)


### Local vs Global matches






### Looking at similarities

if we take absolute number of match we still have problems

    all those have 3 matches:
    match("uni","university")
    match("unicorn","university")
    match("uni","ultra-nihilist")

If we take fraction of second word, we cannot differentiate case 1 and 2. (3/10)
If we take fraction of first word we cannot differentiate case 1 and 3. (3/3)
If we take fraction of average length we cannot differentiate case 2 and 3 !! (3/8.5)

A solution to this could be to have a jaro-wrinkler like score.
let m be number of matches, sa size of a, sb size of b.
score = (m/a + m/b) /2;

This has some interesting properties:

    better score if we match more of a.
    better score if we match more of b.
    minimum score is m/(2a) even if b is infinitely large.



Algorythm
=========

Main bitvector algorythm

> A fast and practical bit-vector algorithm for the longest common subsequence problem (Crochemore 2001)
> igm.univ-mlv.fr/~mac/REC/DOC/01-lcs_ipl.ps
>
> Bit-parallel LCS-length computation revisited (Hyyrö 2004)
> http://www.sis.uta.fi/~hh56766/pubs/awoca04.pdf

Large string algorythm (used when previous algorythm would require >32 bit)

> An input sensitive online algorithm for LCS computation (Hyyrö 2009)
> http://www.stringology.org/event/2009/p18.html
> http://www.stringology.org/event/2009/psc09p18_presentation.pdf

Pack muliple token into a single parralel computation

> Increased Bit-Parallelism
> for Approximate and Multiple String Matching (Hyyrö 2006)
> http://www.dcc.uchile.cl/~gnavarro/ps/jea06.pdf




