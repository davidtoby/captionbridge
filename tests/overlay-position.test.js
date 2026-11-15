import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePosition, clampPosition, DEFAULT_POSITION } from '../extension/src/overlay-position.js';
test('position normalization has stable defaults and rejects non-finite coordinates',()=>{
 assert.deepEqual(normalizePosition(null),DEFAULT_POSITION);
 assert.deepEqual(normalizePosition({x:NaN,y:Infinity}),DEFAULT_POSITION);
 assert.deepEqual(normalizePosition({x:-1,y:8}),{x:0,y:1});
});
test('overlay stays inside player bounds including padding',()=>{
 const result=clampPosition({x:0,y:1},{width:1000,height:500},{width:300,height:100});
 assert.deepEqual(result,{x:0.158,y:0.884});
 assert.deepEqual(clampPosition({x:.4,y:.3},{width:1000,height:500},{width:300,height:100}),{x:.4,y:.3});
});
test('resizing and oversized caption boxes never produce off-player positions',()=>{
 assert.deepEqual(clampPosition({x:1,y:0},{width:100,height:50},{width:300,height:100}),{x:.5,y:.5});
 assert.deepEqual(clampPosition({x:.4,y:.3},{width:0,height:0},{width:300,height:100}),{x:.4,y:.3});
});
