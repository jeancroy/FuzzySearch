import { expect } from 'chai';

import FuzzySearch from '../../dist/FuzzySearch';

describe('adding a new doc with .add()', () => {
  let searcher;
  let newDoc;

  beforeEach(() => {
    const docs = [
      { _id: 1, title: 'Item 1', domain: 'item1.com' },
      { _id: 2, title: 'Item 2', domain: 'item2.com' },
    ];

    searcher = new FuzzySearch({
      source: docs,
      keys: { title: 'title', domain: 'domain' },
      identify_item: doc => doc._id,
    });

    newDoc = { _id: 3, title: 'Item 3', domain: 'item3.com' };

    searcher.add(newDoc);
  });

  it('shows the new doc in search results', () => {
    const results = searcher.search('title:Item');
    const matchingResult = results.find((result) => {
      return result._id === 3;
    });
    expect(matchingResult).to.be.an('object');
  });

  it('has the new doc in the source', () => {
    const lastItemIndex = searcher.source.length - 1;
    const lastItem = searcher.source[lastItemIndex];
    expect(lastItem).to.eql(newDoc);
  });

  it('has the new doc in the index', () => {
    const lastItemIndex = searcher.index.length - 1;
    const lastItem = searcher.index[lastItemIndex];
    expect(lastItem.item).to.eql(newDoc);
  });

  it('update nb_indexed', () => {
    expect(searcher.nb_indexed).to.equal(3);
  });
});
