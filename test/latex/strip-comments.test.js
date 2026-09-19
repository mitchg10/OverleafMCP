import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripComments, stripVerbatim } from '../../src/latex/strip-comments.js';

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

test('a percent inside verbatim is literal, not a comment', () => {
  const src = '\\begin{verbatim}\n100% literal\n\\end{verbatim}';
  assert.equal(stripComments(src), src);
});

test('a comment after \\end{verbatim} on the same line is still removed', () => {
  const src = '\\begin{verbatim}\nx\n\\end{verbatim} % note';
  assert.equal(stripComments(src), '\\begin{verbatim}\nx\n\\end{verbatim} ');
});

test('a commented-out \\begin{verbatim} does not open a verbatim body', () => {
  const src = '% \\begin{verbatim}\nreal % note';
  assert.equal(stripComments(src), '\nreal ');
});

test('verbatim handling preserves line count', () => {
  const src = 'a\n\\begin{verbatim}\n%b\n\\end{verbatim}\n%c';
  assert.equal(stripComments(src).split('\n').length, src.split('\n').length);
  assert.equal(stripVerbatim(src).split('\n').length, src.split('\n').length);
});

test('stripVerbatim blanks the body but keeps the delimiters and comments', () => {
  const src = 'a % keep\n\\begin{verbatim}\n\\section{X}\n\\end{verbatim}\nb';
  assert.equal(stripVerbatim(src), 'a % keep\n\\begin{verbatim}\n\n\\end{verbatim}\nb');
});

test('stripVerbatim covers lstlisting, minted and starred variants', () => {
  for (const env of ['lstlisting', 'minted', 'verbatim*', 'Verbatim', 'alltt']) {
    const src = `\\begin{${env}}\n\\section{X}\n\\end{${env}}`;
    assert.equal(stripVerbatim(src), `\\begin{${env}}\n\n\\end{${env}}`, env);
  }
});
