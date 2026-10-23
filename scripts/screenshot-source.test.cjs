'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pickScreenSource}=require('../src/app/js/haituo-screenshot.js');

test('exact display-id match wins regardless of order',()=>{
  const sources=[{display_id:'99'},{display_id:'42'},{display_id:'7'}];
  assert.equal(pickScreenSource(sources,42),sources[1]);
});

test('a single source is used even without an id match (single monitor)',()=>{
  const only=[{display_id:''}];
  assert.equal(pickScreenSource(only,42),only[0]);
  const unmatched=[{display_id:'zzz'}];
  assert.equal(pickScreenSource(unmatched,42),unmatched[0]);
});

test('multiple unmatched sources are never guessed by index or thumbnail',()=>{
  // Order deliberately does NOT match the display list; a wrong guess here
  // would capture the other monitor and translate the wrong screen.
  const sources=[{display_id:'3'},{display_id:'1'}];
  assert.equal(pickScreenSource(sources,2),null);
  const unordered=[{display_id:''},{display_id:'9'}];
  assert.equal(pickScreenSource(unordered,77),null);
});

test('empty source list yields null',()=>{
  assert.equal(pickScreenSource([],1),null);
  assert.equal(pickScreenSource(null,1),null);
});
