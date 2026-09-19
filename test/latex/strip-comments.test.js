import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripComments } from '../../src/latex/strip-comments.js';

test('removes full-line comments but keeps the line', () => {
  const out = stripComments('a\n% gone\nb');
  assert.equal(out, 'a\n\nb');
});

test('removes trailing comments', () => {
  assert.equal(stripComments('text % note'), 'text ');
});

test('keeps escaped percent signs', () => {
  assert.equal(stripComments('50\\% of x % note'), '50\\% of x ');
});

test('does not treat \\\\% as escaped (backslash-backslash then comment)', () => {
  assert.equal(stripComments('end\\\\% c'), 'end\\\\');
});

test('preserves line count', () => {
  const src = 'a\n%b\nc\n%d';
  assert.equal(stripComments(src).split('\n').length, src.split('\n').length);
});
