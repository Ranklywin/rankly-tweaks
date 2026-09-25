import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeNetwork} from '../shared/metrics.mjs';
test('network statistics handle loss and measure only adjacent successful jitter',()=>{
  assert.deepEqual(summarizeNetwork([10,20,null,100,80]),{average:52.5,jitter:15,loss:20,received:4,sent:5});
  assert.deepEqual(summarizeNetwork([null,null]),{average:null,jitter:null,loss:100,received:0,sent:2});
  assert.deepEqual(summarizeNetwork([0,0]),{average:0,jitter:0,loss:0,received:2,sent:2});
});
