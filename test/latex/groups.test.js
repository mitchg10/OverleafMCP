import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGroup, readOptionalArgs, skipSpace } from '../../src/latex/groups.js';

test('reads a balanced group and reports where it ends', () => {
  const g = readGroup('\\cite{Key} rest', 5);
  assert.equal(g.content, 'Key');
  assert.equal(g.start, 5);
  assert.equal(g.end, 10);
});

test('nested braces do not terminate the group early', () => {
  assert.equal(readGroup('{a {b {c}} d}', 0).content, 'a {b {c}} d');
});

test('an escaped brace does not open or close a group', () => {
  assert.equal(readGroup('{50\\% \\{ and \\} done}', 0).content, '50\\% \\{ and \\} done');
});

test('skips only whitespace before the opening delimiter', () => {
  assert.equal(readGroup('\\cite  \n {Key}', 6).content, 'Key');
  assert.equal(readGroup('\\cite x {Key}', 6), null);
});

test('an unterminated group returns null rather than hanging', () => {
  assert.equal(readGroup('{never closed', 0), null);
});

test('reads a run of optional arguments and stops at the mandatory one', () => {
  const r = readOptionalArgs('[see][p.~3]{Key}', 0);
  assert.deepEqual(r.args, ['see', 'p.~3']);
  assert.equal(r.end, 11);
});

test('no optional arguments is an empty run, not a failure', () => {
  const r = readOptionalArgs('{Key}', 0);
  assert.deepEqual(r.args, []);
  assert.equal(r.end, 0);
});

test('skipSpace stops at the first non-space character', () => {
  assert.equal(skipSpace('   x', 0), 3);
  assert.equal(skipSpace('x', 0), 0);
  assert.equal(skipSpace('   ', 0), 3);
});
