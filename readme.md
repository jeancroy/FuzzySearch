FuzzySearch.js
=====================


What is FuzzySearch.js ?
-----------------------

It is an approximate string matching library with focus on search and especially suggest-as-you-type auto-complete. It support complex input as well as simple list of string and allow you to match item as sentences rather than single words. In addition to searching, we provide on demand Sublime Text like highlight (including free word order on highlight).  The suggestion engine is made to be compatible with multiple UI including [twitter typeahead](https://twitter.github.io/typeahead.js/) and can be used instead of a [bloodhound](https://github.com/twitter/typeahead.js/blob/master/doc/bloodhound.md) object. This library is focused on string processing and do not have any dependency.

Can I see a demo ?
------------------

 You can view the main demo page [here](https://rawgit.com/jeancroy/FuzzySearch/master/demo/autocomplete.html)    
 If you want to see a simple minimal setup, it's [here](https://rawgit.com/jeancroy/FuzzySearch/master/demo/simple.html) 
 
Why a suggestion engine ?
------------------------

Many fuzzy string project are basically a scoring algorithm with a loop to apply it on a list of string. Treating each string as a single word to match. This is perfect for spell checking scenario, but can be insufficient if we deal with object or sentences/expression rater than words. 

This project add infrastructure to accept about any kind of input and loop the scoring algorithm over each words of specified field of your objects. Including field that are array (for example a list of keywords or a list of authors). Then It'll put together a score that take into account the multiple words or multiple fields that matches. Finally it'll allow you to transform the output to your liking for display. 

We aim to be a plug-and-play approximate string matching suggestion engine, you provide your favourite search-box/select-box UI library and we provide data crunching for your query to give you quality matches.


Basic usage
=====================

Minimalist
----------

Basic usage is to create an object that specify the data and keys to be indexed
Then use the method search to perform a search

```javascript
    var data = ["survey","surgery","insurgence"];
    var searcher = new FuzzySearch({source:data});
    var query = "assurance";
    var result = searcher.search(query)
```

Updating the index
------------------

After you create your `searcher`, you can add documents to it using `searcher.add()`.

```javascript
    var data = ["survey","surgery","insurgence"];
    var searcher = new FuzzySearch({source:data});
    var query = "assurance";
    var result = searcher.search(query)
    var newEntry = "surgeon";
    searcher.add(newEntry);
    var newResult = searcher.search("surgeo");
```

The API also supports more advanced tag-based search. See the `Tagged search` section below.

Twitter typeahead
----------------

FuzzySearch support the `__ttAdapter` interface so it can be used instead of a BloodHound object. Setting no output filter output an abject with all match detail (score, matched field, original item) highlight is provided on demand, here we use it at template construction time

```javascript
var books = [{"title":"First Book", "author":"John Doe"}, {"title":"...", "author":"..."}];
var fuzzyhound = new FuzzySearch({source:books, keys:["title","author"] });

$('#typeahead-input').typeahead({
            minLength: 2,
            highlight: false //let FuzzySearch handle highlight
        },
        {
            name: 'books',
            source: fuzzyhound,
            templates: {
                suggestion: function(result){return "<div>"+fuzzyhound.highlight(result.title)+" by "+fuzzyhound.highlight(result.author)+"</div>"}
            }
        });
```

How is this library different ?
-----------------------

- Scoring each item as a sentence instead of a single word is probably a good selling point, even if you do not need more advanced input/output capabilities.
  And while the extra loops are not that hard, the algorithm used for the character-by-character "hot loop" support scoring multiple query in parallel, so we are very efficient at solving this task.

- We use bit-parallelism to have a very compact representation of the problem  and speed-up the search.  The idea is that changing one bit or changing 32 bit in an integer take the same amount of time. This basically mean we can search for a 2 character words or 30 character words with the same amount of computation. However 30 character words are quite rare. So we use a modified algorithm that pack multiple words in the same query. For example we could pack six 5 characters words in the same query in the above mentioned hot loop.

- Have more than 32 chars ? No problem ! We'll use as many bit-packed query as you need to search for the whole data. Have a single word bigger than 32 char ? A `System.Namespace.Library.something.field` symbol maybe ? No problem, we got you covered and we'll transparently switch to an non bit-vector based implementation. 

- However, focus on speed is not there to be frugal or beat benchmarks, instead we use it to compute more things and try to be as user-friendly as possible with the computation budget.

- Scoring is based on a exact problem like [Levenshtein edit distance] (https://en.wikipedia.org/wiki/Levenshtein_distance),
  but we focus on similarities instead of distance, using [Longest common subsequence](https://en.wikipedia.org/wiki/Longest_common_subsequence_problem).
  When searching from a list of string with different length, there's quite a bit of difference between `the most similar` and the `least errors`. We believe looking at similarities give intuitive results for an autocomplete scenario. (you can see a discussion about scoring below)


A note about speed
-------------------

There's a few way to achieve speed in javascript. One common pattern is to cache quantities that don't change out of loop. Another way is to understand that modern browser will optimize javascript, but have to switch to slower version of the code when javascript behave away from statically typed language, this is one reason you'll see jsdoc type annotation in this project.

But the most important contribution to speed is algorithm: we can try to find a fast way to compute something, but we can gain more if we find something else, easier to compute, that is somehow equivalent. However fast case often only cover a specialized case. So for that reason we provide 4 different algorithms that solve similar problem (scoring a single keywords, scoring multiple keyword in parallel, scoring long keywords, highlight). There's no configuration, we'll switch transparently to the best algorithm for the task, so whatever you are trying to do there's some fast path for it. 
 


Scoring overview
=====================

General principle is to be very flexible in finding a match, prefer return a loose match than nothing, but give higher score when we do not need the flexibility (more exact match)

Scoring an item
----------------

FuzzySearch support quite complex items, query is compared to specified field.
Suppose we have an array of books, where each book looks like this:

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

First step is to tell FuzzySearch what key to index:  

- `keys = "" or [] or undefined` This indicate source is a list of string, index item directly  
- `keys = "title" or ["title"]` This indicate index a single field `title`  
- `keys = ["title","author.fullname"]` This indicate index multiple fields
- `keys = {title:"title",author:"author.fullname"}` This indicate index multiple fields and setup aliases/tags

for all the above syntax you can optionally add a path prefix `item.`: all the following are equivalent: `title`, `.title` , `item.title`


#### Example

With the above book object and this set of keys:

```javascript
keys = ["Title","Author","Year","Keywords","Reference.ISSN"]
```

First thing we do is to build a list of field values. Then normalize the text to lowercase and with some common accent removed. If field is an array all it's sub elements are inserted. Values are inserted for a key value map.
We nested path (things.this.that).

```javascript
Fields = [ ["cliche a paris, the"],
           ["john middlename doe"],
           ["1977"],
           ["story","boy"],
           ["00-11-22"]
           ]
```

#### Wildcard

Note: you can use the Wildcard `*` to process array of objects or dictionary of objects `myArray.*.property` is equivalent of adding

```javascript
    myArray.0.property
    myArray.1.property
      ...
    myArray.N.property
```


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

This query would match in both `title` and `year` field:

> cliche 1977

Flip side of allowing Multiple field matching is giving preference to words in the same field:

> "john doe", two word, same field

Score is average of
 1. best score, every query token on the best field for the item
 2. best score, every query token on any field (their best field)
 
### Tagged search

By default any query keyword can match against any field, but you can use tagged search syntax to specify which field to match. 
> **fieldname:** my specific query  
> part that match any field **fieldname:** match specific field  
> match any **fieldname:** match1 **fieldtwo:** match another  

Anything before `field:` separator perform normal match. Everything after a separator, up to the next one, match only on specified field.
We recognize reserved field name and will treat `something-else:` as a normal word rather than a separator.

Field name come from key path, this example produce separator `title:` and `author.fullName:`  
```javascript
keys = ['title','author.fullName']
```

You can use alias feature to specify how you want to name each field, this example produce separator `title:` and `author:`  
```javascript
keys = {title:'title',author:'author.fullName'}
```


### Output map

#### Get Score detail (SearchResult object)

Setting `output_map="root"` return the object as we use internally for sorting and scoring

```javascript
    result = {
        score:8.1,
        item:{}, //original item
        matchIndex:2
        sortkey:"..."
    }
```

you can use `instance.getMatchingField(result)` to recover matching field.

#### Get Original object

Setting `output_map="item"` or `output_map="root.item"` give you back original item as given to the algorithm. This indicate you do not need all match detail and allow to skip some step (like finding original spelling of matching field)

#### Get a field from the original object

If you only need the id or title of the original item you can do it like that `output_map="item.property"` or `output_map="root.item.property"`

#### Use custom output object (Aliases)

To achieve that, you need to set `keys` option to a dictionary of `{output:input}` and set `output_map="alias"`. In that case we'll produce the requested format for you. If output is an array we'll apply `options.join_str` to join the elements (default to `", "`)

Example Input: 
```javascript
    keys = {
        title:"item.title",
        authors:"item.authors.*.Fullname",
    }
```

Example output: 
```javascript
    result = {
        title:"Some book",
        authors:"John Doe, Someone Else",
        _match:"John Doe",
        _score:8,
        _item: {/*original object*/}
    }
```
As you can see we append match detail to the end of custom output. Do not use those name in the key value map or they'll get overwritten.

### Output score threshold

Default value are for suggestion as you type. In this case we prefer to show poor matches than nothing, match will improve as we type more.

> Parameter `thresh_include` control the minimum score to show

We also want to limit choices to a good match or a few good matches if those exist. For example if the best score is twice as good as the next best one, it's obviously the candidate to show.

> Parameter `thresh_relative_to_best` control ratio of best match needed to be shown on the list

Lastly if an item have multiple keyword, we might want to stop searching once we have found a good keyword. If a match is this good it'll be shown, no matter the best threshold.

> Parameter `field_good_enough` control the score needed to stop the search on this item. It also control forced inclusion, not matter best





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

```javascript
    2*llcs = m + n - ed
```

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

Let's examine a Jaro like score: let `m: be number of matches`, `sa: size of a`, `sb: size of b`.

```javascript
    score = (m/sa + m/sb) /2;
```

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

(Please see top of JS file for exact options list)

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
| highlight_prefix         | false   | true: force prefix as part of highlight (false: minimum gap slower)|
| highlight_bridge_gap     | 2       | display small gap as substitution set to size of gap 0 to disable|
| highlight_tk_max_size    | 64      | max size of a token for highlight algorithm (it is BVMAXSIZE(31) for search)|
| highlight_before         | ...     |   tag to put before the highlight <br> `default: <strong class="highlight">`|
| highlight_after          |  ...    | after the highlight <br> `default: </strong>`   |
| max_inners               | null    | Optional. High positive count mitigation for large datasets. See same  [fuzz-aldrin-plus](https://github.com/jeancroy/fuzz-aldrin-plus/blob/c8cf693ee77909d0dbfbc90b452733bba5e5c8bd/README.md#high-positive-count-mitigation) argument|


Algorithms
=========

Dynamic programming
------------------
A very efficient way to solve the longest common substring problem is dynamic programming. We don't use that algorithm for scoring per se, but algorithms we use are clever ways to fill that same table using less efforts, so it's important to understand. (Note that the highlight algorithm is a dynamic programming table that solve a generalization of this problem, where we not only score match but penalize gap.)

|  /  |s|u|r|g|e|r|y| 
|:---:|-|-|-|-|-|-|-| 
|**g**|0|0|0|1|1|1|1| 
|**s**|1|1|1|1|1|1|1| 
|**u**|1|2|2|2|2|2|2| 
|**r**|1|2|3|3|3|3|3| 
|**v**|1|2|3|3|3|3|3| 
|**e**|1|2|3|3|4|4|4| 
|**y**|1|2|3|3|4|4|5|  



Bit-Parallelism 
---------------
(See Crochemore 2001, Hyyrö 2004)

One clever observation about above problem is that two consecutive cell can only change by up to 1 point. So basically we can store above table row by row table as increase/no-increase for each column. Because there's only two state we can use a single bit per column.

That's efficient storage, but what's great is that this storage trick allow to benefit from hardware that is able to operate on 32 or 64 bit at a time. (Javascript can only use 32 bit integer)

This is an example algorithm.
Let `strA` be the query, position of each character is recorded for fast search later. Let `strB` be the entry in the database we are trying to score.


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

// Fill LCS dynamic programming table
// bitvetor S record position of increase.
// Whole line computed in parallel !
// (Same cost to update 1 bit or 32)
// See Hyyrö, 2004 with S representing V'

for (j = 0; j < n; j++) {
    U = S & aMap[strB[j]];
    S = (S + U) | (S - U);
}

S = ~S & mask;
//Count the number of bit set (1) in S.
//this give you number of matching character (llcs) in strA, strB.
//We'll see below there's still improvement that can be made to this score.
```

This algorythm allow a performance profile of O(m+n) instead of typical O(m*n).


Multiple string in parralel 
---------------------------
(See Hyyrö & Navarro 2006)

Processing 32 character at the cost of 1 looks like a huge speed up. Until you realize english words are more like 5 character long. A natural question to ask then is : would it be possible to pack multiple words, as if it where a larger one, and still keep separate score ?

Indeed it is with some modification, hot loop become:
```javascript
for (j = 0; j < n; j++) {
    U = S & aMap[strB[j]];
    S = (S&ZM + U&ZM) | (S - U);
}

S = ~S & mask;
//Count the number of bit set (1) in each region of S.
```

With ZM a bit-vector that is 1 inside each words and 0 at word boundary (that is the last character of each word in this case). There's 6 operations instead of 4 so we can score n words\* at the cost of 1.5 (\*as long as total length is less than 32)


Quote from (Hyyrö 2006) with symbol renamed to fit code. `S[m]` refer to the m th bit of S.

> We first note that subtracting the vector `U =  S & aMap` from  `S` does not create any carry effects. So the only possible source of interference between different bit regions is the addition  `S + U` ,  and this can be fixed by changing the addition into the form `( S & ZM ) + ( U & ZM )`.  To confirm that this modification does not affect the correct behaviour of the algorithm,  we note the following: If  `S[m] = 0` before the addition, then also `U[m] = 0` and the modification has no effect. If  `S [m] = 1` and `U[m] = 1` before the addition, then the first m bits of the result are the same: the modification just removes the (m +1)th carry bit. Finally, if  `S[m] = 1` and `U[m] = 0` before the addition, then the m th bit of the result of the addition is not important: the result is anyway `|` with `( S − U )`, which has its m th bit set in this case


Position Based 
---------------
(See Hyyrö 2009)

Similar idea to the bit-vector algorithm, first we find an efficient way to represent the problem and the saving in space translate to a saving in computation time.

We'll still record position where dynamic programming table increase, but instead of recording it as a bit position, we record it as a number, allowing to go over 32 characters limitation.

More precisely we'll store sequence of consecutive increase instead of each increase one by one. Those sequence naturally arise when there's sequence of consecutive character that match. (This allow to speed up region of high similarity)

 One the block is formed it'll act as a single unit for the rest of computation.  The algorithm also take advantage of region without matches by not registering block at those region.


````
    s u r g e r y
 g [0,0,0,1,1,1,1] : [3,4] (Add level 1)
 s [1,1,1,1,1,1,1] : [0,1] (Make level 1 happens sooner)
 u [1,2,2,2,2,2,2] : [0,2] (Add level 2, append to block of consecutive increase)
 r [1,2,3,3,3,3,3] : [0,3] (Add level 3, append to block of consecutive increase)
 v [1,2,3,3,3,3,3] : [0,3] (v not in surgery, copy)
 e [1,2,3,3,4,4,4] : [0,3],[4,5] (Add level 4, create new block for it)
 y [1,2,3,3,4,4,5] : [0,3],[4,5],[6,7] (Add level 5, create new block for it)

````


````
  12345678901234567890   Position (for this demo we start at 1)
  ii------iii---i--i--   Increase point of previous line
  12222222345555666777   Score previous line [1,3] [9,12] [15,16] [18,19]
  ---m-m---------m---m   Match of this line
  12233333345555677778   Score of this line [1,3] [4,5] [10,12] [15,17] [20,21]
  ii-i-----ii---ii---i   New increase point
  12345678901234567890   Position
````

 - There is 2 Basic operations:
   - Make a level-up happens sooner
   - Add an extra level up at the end. (this is where llcs increase !)

 - Two consecutive increase point without match between them ?
    - Copy from last line.

 - An increase point and a match at the same position ?
   - Copy from last line.

 - The pattern that trigger a change from last line is:
   -  ** first match between two increase point **

 - Match at position 4 is dominant, it make the value increase form 2 to 3.
 Match at position 6 is recessive, it also make value from 2 to 3 BUT value for the line was already 3.
       All thing considered that match point could have been removed

 - When registering a dominant match, we'll either
   - grow an existing block if the math happens right after one
   - start a new block.

 - Because match make increase point happens sooner
 we also need to remove one increase point from following block.
 if the initial length was 1, the length is now 0 and block is skipped
 otherwise it is copied to current line.


References
==========

Main bit-parallel algorithm

> A fast and practical bit-vector algorithm for the longest common sub-sequence problem (Crochemore 2001)
> igm.univ-mlv.fr/~mac/REC/DOC/01-lcs_ipl.ps
>
> Bit-parallel LCS-length computation revisited (Hyyrö 2004)
> http://www.sis.uta.fi/~hh56766/pubs/awoca04.pdf

Pack multiple token into a single parallel computation

> Increased Bit-Parallelism
> for Approximate and Multiple String Matching (Hyyrö 2006)
> http://www.dcc.uchile.cl/~gnavarro/ps/jea06.pdf

Large string algorithm (used when previous algorithm would require >32 bit)

> An input sensitive online algorithm for LCS computation (Hyyrö 2009)
> http://www.stringology.org/event/2009/p18.html
> http://www.stringology.org/event/2009/psc09p18_presentation.pdf

Sequence alignment (highlight)
> Smith Waterman Gotoh
> http://www.bioinf.uni-freiburg.de/Lehre/Courses/2014_SS/V_Bioinformatik_1/gap-penalty-gotoh.pdf
> http://telliott99.blogspot.ca/2009/08/alignment-affine-gap-penalties_08.html

Comparison of some string similarity measurements
> https://asecuritysite.com/forensics/simstring


Development & Tests
===================

See [src/readme.md](src/readme.md) for some information about how the code is laid out.

Install Dependencies
--------------------

    yarn

Run Tests
---------

Tests are located in test/ and use Mocha, JSDom, and Babel for ES6 syntax support (in tests only).

To run tests:

    yarn test
