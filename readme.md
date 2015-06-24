FuzzySearch.js
=====================

What is FuzzySearch.js ?
-----------------------

It is an approximate string matching library with focus on search and especially suggest-as-you-type auto-complete. The suggestion engine is compatible with twitter type-ahead and can be used instead of a bloodhound object. This library / suggestion engine do not have nay dependency. It is also focused on string processing and will not do ajax call by itself.

It perform three kind of operation:

1. Searching

    Perform the scoring operation on all item keyword.  
    Manage logic of why an item would have a better overall score than another given multiple axproximately matched keyword

2. Scoring

    Given two word how clore are they ?  
    Is word A closer to B or to C ? Is Match(A,B) worth less or more than Match(C,D) ?  
    We try to answer those question in an autcomplete scenario. Error in what is already typed probably worth more than a character not yet typed.
    This would not be the case in a spellchecker setup for example.


2. Highlighting

    Highlight is provided on demand. First best 1:1 pairing between query and field tokens is computed. Then we compute matching characters between the two tokens, taking special care to output the most compact match when multiple one are possible.

Can I see a demo ?
------------------

 [You can view the demo page here](https://rawgit.com/jeancroy/FuzzySearch/master/demo/autocomplete.html)

Is this based on edit distance ?
--------------------------------
Short answer: No. Medium answer: Sort of. Long answer: there's a whole section below about how we calculate a score.

All this to say, this provide a different scoring than typical levenshtein distance, it might be better or worse suited to your application. For example in suggest-as-you-type scenario it might be better to show vague suggestion than nothing. For situation where we ask if two things are the same (person, address, etc) it might be better to have more strict positive matches.


What is LCS ?
----------------------
Longest common sub-sequence. Shared character between two string in the right order. lcs(survey, surgery) = surey.

Computer science often think similarity between two string in term of error (distance). And computational biology in term of matches. (We can view matching in Proteins, DNA, etc as a string problem).

They are related but different problem and the bet of this project is that LCS could be useful for auto-complete scenario (with some help). As a bonus it's often faster to compute.

Algorythm
=========
The whole library is a very elaborate suport arround the following snippet.
Let `strA` be the query, position of each character is recorded for fast search later. Let `strB` be the entry in the database we are trying to score. Second loop is the important part. One lookup and 4 bit operation per character of `strB`. That's where speed is.


```javascript
var m = strA.length;
var n = strB.length;
var aMap = {};

// - - - - - - - -
// PRECOMPUTE:
// - - - - - - - -

//Map position of each character of a (first char is lsb, so rigth to left)
// --------------"retcarahc"
// aMap["a"] =  0b000010100

for (i = 0; i < m; i++) {
    aMap[strA[i]] |= (1 << i)
}

var mask = ( 1 << m ) - 1;
var S = mask, U;

// - - - - - - - -
// For each item
// - - - - - - - -

// Fill LCS dynamic programing table
// bitvetor S record position of increase.
// Whole line computed in parralel !
// (Same cost to update 1 bit or 32)
// See Hyyrö, 2004 with S representing V'

for (j = 0; j < n; j++) {
    U = S & aMap[strB[j]];
    S = (S + U) | (S - U);
}

S = ~S & mask;
//Count the numer of bit set (1) in S.
//this give you number of matching character (llcs) in strA, strB.
//We'll see below there's still improvement that can be made to this score.
```

This algorythm allow a performance profile of O(m+n) instead of typical O(m*n).
Plus no elaborate data structure so constant should be low. Count dictionary as elaborate ? Maybe, but whole javascript is built around dictionary, even plain array.

V2
----

Just after we tell you how bit parralelism allow to process a 30 char search at the same cost of a single char,
we go on and apply the algorithm on english word using of about 5 char, and we use 5 out of 30 available bits.
V2 use a mofified algorithm that allow to pack multiple words in a single 32bit numbers and keep independent score for each word.
(For example we can use a single pass to process 6 words of 5 char) instead of 6 different pass. 

Theoretical speedup is important.  However it make scoring more complex, so in the above case we have a speedup of about 2x instead of 6x or so.
There's probably room to improve the code.

Basic usage
=====================

Minimalist
----------

Basic usage is to create an object that specify the data and keys to be indexed
Then use the method search to perform a search

```javascript
    var data = ["survey","surgery","insurgence"];
    var searcher = new FuzzySearch({source:data, output_map:"item"});
    var query = "assurance";
    var result = searcher.search(query)
```

Twitter typeahead
----------------

FuzzySearch support the \__ttAdapter interface so it can be used instead of a BloodHound object. Setting no output filter output an abject with all match detail (score, matched field, original item) highlight is provided on demand, here we use it at template construction time

```javascript
var books = [{"title":"First Book", "author":"John Doe"}, {"title":"...", "author":"..."}];
var fuzzyhound = new FuzzySearch({source:data, keys:["title","author"], output_map:"" });

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
```


Scoring overview
=====================

General principle is to be very flexible in finding a match, prefer return a loose match than nothing, but give higher score when we do not need the flexibility (more exact match)

Scoring an item
----------------

FuzzySearch support quite complex items, query is compared to specified field.

```javascript
    book = {
        Title: "Cliché à Paris, The",
        Year: 1977,
        Author: "John MiddleName Doe",
        Keywords:["Story","Boy"],
        Reference:{ISSN:"00-11-22", ARK:"AA-BB-CC"},
        Available:4
    }
```

### Collect information (And normalize)

```javascript
keys = ["Title","Author","Year","Keywords","Reference.ISSN"]
```

First thing we do is to build a list of field value, normalized to lowercase and with some common accent removed. If field is an array all it's sub elements are inserted. Values are inserted for a key value map.
We support path (things.this.that).

```javascript
Fields = ["cliche a paris, the","john middlename doe","1977","story","boy","00-11-22"]
```

Note: you can use the wildcard `*` to process array of objects or dictionary of objects  
`myArray.*.property` is equivalent of

    myArray.0.property
    myArray.1.property
    myArray.2.property
      ...
    myArray.N.property

### Field priority

It often make send to give more weight to the title than first keyword,
more weight to first keyword than second and so on.

This is achieved using an exponentially decaying bonus. First item have twice the score then bonus decay to one. This is it give a marked difference between first and second item and not so much item 4th going on.

Parameter (`d = bonus_position_decay`) control the decay:
```javascript
bonus = 1.0+d^n
```

|Position          | 0   | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8    |
|------------------|-----|-----|-----|-----|-----|-----|-----|-----|------|
|Bonus (d=0.5)     | 2.0 | 1.5 | 1.25| 1.13| 1.06| 1.03| 1.02| 1.01| 1.003|
|Bonus (d=0.7071)  | 2.0 | 1.7 | 1.5 | 1.35| 1.25| 1.18| 1.13| 1.09| 1.063|


### Free word order

Often words keep their meaning even when out of order.
Those will all match the author keyword:

    John Doe
    Doe John
    John doe Midle

Another example where free word order is useful would be natural language query:
Match:  `How to paint my wall ?` against `Wall painting 101`

Flip side of allowing free word order is preferring properly ordered words. This is done by giving a bonus of (`bonus_token_order`) each time two consecutive token in the query are in order in the match

### Multiple field matching

> cliche 1977

This query would match in both `title` and `year` field.
Flip side of allowing Multiple field matching is giving preference to words in the same field:

 >"john doe", two word, same field

Score is average of
 1. best score, every query token on the best field for the item
 2. best score, every query token on any field (their best field)

### Output score thresholding

Default value are for suggestion as you type. In this case we prefer to show poor matches than nothing, match will improve as we type more.

> Parameter `thresh_include` control the minimum score to show

We also want to limit choices to a good match or a few good matches if those exist. For example if the best score is twice as good as the next best one, it's obviously the candidate to show.

> Parameter `thresh_relative_to_best` control ratio of best match needed to be shown on the list

Lastly if an item have multiple keyword, we might want to stop searching once we have found a good keyword. If a match is this good it'll be shown, no matter the best threshold.

> Parameter `field_good_enough` control the score needed to stop the search on this item. It also control forced inclusion, not matter best



### Output map

#### Full detail

Setting `outputmap=""` return the object as we use internally for sorting and scoring

```javascript
    candidate = {
        score:8.1,
        item:{}, //original item
        match:"1977",
        matchIndex:2
    }
```

#### Original detail

Setting `outputmap="item"` give you back original item as given to the algorithm. This indicate you do not need all match detail and allow to skip some step (like finding original spelling of matching field)

#### Property of an original item

If you only need the id or title of the original item you can do it like that `outputmap="item.property"`



Scoring a token (in a auto-complete friendly manner)
--------------------------------------------------

There's two main way to count string similarity one is to count the number of matches the other one is to count the number of error. Those refer to the length of the longest common sub-sequence and the edit distance problem. (Here we'll consider only the simple edit distance with only insertion/deletion )

Match are show with "|" and error are show with "-"

    sur-ve-y
    |||  | |
    surg-ery

match: 5, error: 3


Both are related, but when comparing score of different length they can lead to different conclusions.

    match("uni","university") : match 3, error 7
    match("uni","hi") : match 1, error 2

First pairing have more match, second pairing have less error.
Most algorithm available use edit distance (error)
yet somehow uni -> university is a intuitive match.

### Looking at relative errors

One way to deal with different match length is to normalize error count by the length. Which one? Let's try to compare error count with length of second term...

    match("uni","university") : 7 error/10 char = 0,7 error/char
    match("uni","hi") : 2 error/3 char = 0,666 error/char

Second match still have a lower relative error count.
Even worse, the number of relative error are very close...

    match("uni","universit") : 6 error 9 char, 0,666 error/char
    match("uni","universi") : 5 error 8 char, 0,625 error/char

At that point pairing decision is now reversed. Relative error is not a very stable score.

### Different similarity metric

**Simple edit distance** consider only count the number of insert / delete operation needed to go from string A to string B. For example type/typo are at a distance of 2: `del[e], ins[o]`.

**Levenshtein edit distance** add substitution.  For example type/typo are at a distance of 1: `subs[e,o]`. It improve over simple distance that wrong character error are not penalized twice. However it loose the ability to prefer transposition.

**Damerau edit distance** add transposition operation. This has make a metric that do not over penalize substitution, but also prefer word that had letter swapped (not that simple edit distance had that transposition preference too)

Each time we add operation we have the opportunity to better model the error, but it add computation cost

#### Edit distance (lower is better)

|Distance | ed | BULB / BOOB | ed | BULB / BLUB |
|:---------|----|-------------|----|-------------|
| Simple  | 4  |  `B--ULB Ins[OO]`<br> `BOO--B Del[UL]` | 2 |` B-ULB Ins[L]` <br> `BLU-B Del[L]` |
| Levenshtein   | 2  |  Subs[U,O]<br>Subs[L,O] | 2 | Subs[U,L]<br>Subs[L,U] |
| Damerau | 2 | Subs[U,O]<br>Subs[L,O] | 1 | Transpose[U,L] |

#### Matching characters (LCS, higher is better)

|Metric | L | BULB / BOOB | L | BULB / BLUB |
|:------|---|-------------|---|-------------|
| length of lcs  | 2  | BB | 3 | BUB or BLB |


This metric is interesting for a number of reason. First we can remember the above case of `match("uni","university")` vs `match("uni","hi")` : intuitively we tend to count match rather than errors. Then this comparison show that counting match result in a scoring similar to Damerau-Levenshtein. No over-penalty on substitution and partial score for transposition.

Possibly more interesting, length of LCS is fast to compute. Similar in complexity than simple edit distance. Indeed, if we set `m: length of string A`, `n: length of string B`, `ed: simple edit distance with unit cost`. `llcs:length of lcs`, we have:

> 2*llcs = m + n - ed

So basically we can learn from that than:
 - If we have either llcs or simple edit distance we can get compute the other.
 - The 2 in front of llcs is the reason we do not double penalize substitution.

Please note that while `find the longest subsequence between A and B` and `find the shortest edit distance between A and B` are equivalent while comparing all of A versus all of B (Global match). They are not equivalent while comparing part of A versus part of B (Local match) or all of A versus part of B (Semi-Global, search a needle in a haystack). This explain that they are different research topic with different typical use.

Furthermore, the resulting score are not equivalent while sorting a list of possible matches of varying length. This is the point we tried to make while comparing `"uni"` to `["hi","university"]`. The hypothesis behind this project is that counting matches is more intuitive and should better match user expectation in an interactive user interface.

##### But, is there a catch ?

Where simple edit distance can be overly severe, llcs can be overly optimistic.
Matching 3 out of 4 character, or matching 3 out of 40 both give a score of 3.
To some extend we want this (better to show something than nothing).
But, we also want to give better score to better match, so we have to find to include back some information about error.

### Looking for a score relative to input length

Let's consider those three cases:

```javascript
    match("uni","university")     // case 1
    match("unicorn","university") // case 2
    match("uni","ultra-nihilist") // case 3
```

Let m be the number of matches

- If we compare m to second word length,
	- we cannot differentiate case 1 and 2. (3/10)
- we compare m to first word length,
	- we cannot differentiate case 1 and 3. (3/3)
- If we compare m to average of both length,
	-  we cannot differentiate case 2 and 3 !! (3/8.5)

From that we learn that we want to include both length, but not in the form of arythmetic average of both. We need to do more research !

#### Jaro–Winkler distance

The [Jaro–Winkler distance ](https://en.wikipedia.org/wiki/Jaro%E2%80%93Winkler_distance) is an heuristic algorithm for string matching. It's fast and perform well in different comparison.  In particular the *Jaro* distance use an approximation of LCS and then report it back to a score ranging from 0-1, combining length of both string. *Wrinkler* add the idea to give a bonus for common prefix, prefix bonus looks like something that fit well in a auto-complete scenario.

Let's examine a jaro like score: let `m: be number of matches`, `sa: size of a`, `sb: size of b`.

    score = (m/sa + m/sb) /2;

This has some interesting properties:

 - better score if we match more of a.
 - better score if we match more of b.
 - minimum score is m/(2a) even if b is infinitely large.

We do not have access to a number of transposition like *Jaro*, BUT lcs restrict matches to those that are in correct order, so we have some transposition effect built-in the value of llcs.

#### Prefix

There's some very efficient way to compute number of matches between two string, but most of them rely on simplifying the original problem. One such simplification is to only store the score and not the different possible path possible to reach that score.

On the flip side, human most often input start of word rather than something in the middle. Prefix is a common sub-string of both inputs that start at first character. It's fast to compute, and allow to shrink the problem size for llcs computation. We'll add some bonus for common prefix controlled by `bonus_match_start`. That's the Winkler like part of our scoring algorithm.

Compromise of using exact prefix is that a typo at the start of the word will stop  match, so it can induce a heavy penalty.

#### Matching multiple keywords

For matching a single token, we have a pretty interesting solution. However testing revealed that this scoring scheme gave disproportionate importance to small words. For example matching perfectly `of` or matching perfectly `Honorificabilitudinitatibus` both give a score of 1. However one is clearly easier to match than the other.

We'll use the match length as a shortcut to specificity. (Doing this, we assume common words are short to use least amount of effort for a specific communication need).

We multiply Jaro-like score by llcs and the score become:
```javascript
	score = 0.5*m*(m/sa + m/sb)  + bonus*prefix;
```

Having m squared give the advantage of even better score for good matches and worse score for bad match. It lower the likelihood of multiple bad match out-score a single good match. A character matched in a good token is now worth more than a character matched in a bad token.







Configuration
==============


| Parameter                | Default | Description |
|:--------------------------|---------|-------------|
| minimum_match            | 1.0     | Minimum score to consider two token are not unrelated |
| thresh_include           | 2.0     | To be a candidate score of item must be at least this |
| thresh_relative_to_best  | 0.5     | and be at least this fraction of the best score |
| field_good_enough        | 20      | If a field have this score stop searching other fields. (field score is before item related bonus) |
| bonus_match_start        | 0.5     | Additional value per character in common prefix |
| bonus_token_order        | 2.0     | Value of two token properly ordered |
| bonus_position_decay     | 0.7     | Exponential decay for position bonus (smaller: more importance to first item) |
| score_round              | 0.1     | Two item that have the same rounded score are sorted alphabetically |
| output_match_detail      | true    | if false output original item if true output {score:...item:...match:... matchIndex:...} |
| cache_fields             | true    | Perform the "collect" step only once and store result. Save computation time but use duplicate indexed fields  |
| max_search_tokens        | 10      | Because of free word order each search token add cost equivalent to one traversal additional tokens are lumped as a nth+1 token|
| max_candidates           | 100     | Stop search after that many good candidate found Will trigger a recount to enforce relative_to_best rule|
| highlight_prefix         | false   | true: force prefix as part of highlight (false: minimum gap slower)|
| highlight_bridge_gap     | 2       | display small gap as substitution set to size of gap 0 to disable|
| highlight_tk_max_size    | 64      | max size of a token for highlight algorithm (it is BVMAXSIZE(31) for search)|
| highlight_before         | ...     |   tag to put before the highlight <br> `default: <strong class="highlight">`|
| highlight_after          |  ...    | after the highlight <br> `default: </strong>`   |



Algorithms
==========

Main bitvector algorythm

> A fast and practical bit-vector algorithm for the longest common sub-sequence problem (Crochemore 2001)
> igm.univ-mlv.fr/~mac/REC/DOC/01-lcs_ipl.ps
>
> Bit-parallel LCS-length computation revisited (Hyyrö 2004)
> http://www.sis.uta.fi/~hh56766/pubs/awoca04.pdf

Large string algorithm (used when previous algorithm would require >32 bit)

> An input sensitive online algorithm for LCS computation (Hyyrö 2009)
> http://www.stringology.org/event/2009/p18.html
> http://www.stringology.org/event/2009/psc09p18_presentation.pdf

Pack multiple token into a single parallel computation

> Increased Bit-Parallelism
> for Approximate and Multiple String Matching (Hyyrö 2006)
> http://www.dcc.uchile.cl/~gnavarro/ps/jea06.pdf

Sequence alignment (highligth)
> Smith Waterman Gotoh
> http://www.bioinf.uni-freiburg.de/Lehre/Courses/2014_SS/V_Bioinformatik_1/gap-penalty-gotoh.pdf
> http://telliott99.blogspot.ca/2009/08/alignment-affine-gap-penalties_08.html

Compaison of some string similarity
> https://asecuritysite.com/forensics/simstring

