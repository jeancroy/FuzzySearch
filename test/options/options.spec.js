import { expect } from 'chai';

import FuzzySearch from '../../dist/FuzzySearch';

describe('saving options', () => {
  it('saves options in searcher.options', () => {
    const docs = [
      { _id: 1, title: 'Item 1', domain: 'item1.com' },
      { _id: 2, title: 'Item 2', domain: 'item2.com' },
    ];

    const searcher = new FuzzySearch({
      source: docs,
      keys: { title: 'title', domain: 'domain' },
      identify_item: doc => doc._id,
      field_good_enough: 19,
    });

    expect(searcher.options.field_good_enough).to.equal(19);
  });
});
