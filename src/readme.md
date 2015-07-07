#Structure

## required

### init.js

- Main constructor
- Default settings
- Handle init, setting change and refresh.
 
### source.js
   
- Build index
- Loop tru your source, collect values specified by keys
- Normalize text (whitespace, uppercase, accents)
- Split in words, ignore words too small, truncate words too long (user defined)
- Generate acronym.

   
### query.js
    
- Find special `tagged:` query.
- Apply same preparation process than source.js (will use function of that file)
- Prepare words for scoring (record position of each character in the word)

### string.js

- hold definition string utility functions shared by source/highlight


### search.js
    
- Call the pre-processing parts
- Loop score function over each word of prepared source
- Put together the word(token) into a field score
- Put together the field score into an item score
- Find item that best match
- Call the post-processing parts
    
### score.js

- Main data crunching, hot loop
- provide algorithms for scoring 
    - a single query word, 
    - multiple query word in parralel, 
    - or a large query word (over 32 char).

### output.js

- Build, filter & sort initial list of candidate
- Apply user defined transformation

## Optional    
    
### ui.js

- Provide callback for direct integration with some autocomplete UI library.
- Provide adaptative debounce (learn search time on this source/machine)

### highlight.js

- Provide on demand highlight
- Match query words against displayed words
- Align letter in each words
- Build highlighted html with configurable open and close tags.
   

    
    
   
