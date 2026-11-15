// Wide screen driving, the page's part (src/wide.ts): the area the game is told its picture is shown in, and the
// scale a wide picture can be drawn at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { viewPixels, fitScale } = await load('wide.ts');

test("the view is the stage in the display's own pixels", () => {
  assert.deepEqual(viewPixels(3440, 1270, 1), [3440, 1270]);
  assert.deepEqual(viewPixels(1280, 720, 1.5), [1920, 1080]);
  assert.deepEqual(viewPixels(1536.4, 863.6, 1.25), [1921, 1080]);
});

test('a stage without a size is "not known"', () => {
  assert.deepEqual(viewPixels(0, 0, 1), [0, 0]);
  assert.deepEqual(viewPixels(800, 0, 2), [0, 0]);
  assert.deepEqual(viewPixels(NaN, 600, 1), [0, 0]);
});

test('the scale is cut to what the card can hold as one texture, never under 1', () => {
  assert.equal(fitScale(3, 640, 480, 8192), 3);
  assert.equal(fitScale(4, 1834, 768, 8192), 4);
  assert.equal(fitScale(4, 2764, 768, 8192), 2);
  assert.equal(fitScale(4, 1024, 3000, 8192), 2);
  assert.equal(fitScale(2, 9000, 480, 8192), 1);
});
