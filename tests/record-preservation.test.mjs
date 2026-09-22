import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/opencode/format.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { mergeSessionMessageRecords, toTranscriptEntry } = await import(`data:text/javascript,${encodeURIComponent(output)}`);

function record(id, text, error) {
  return {
    info: { id, role: 'assistant', sessionID: 'session-1', time: { created: Number(id.split('-')[1]) * 1000 }, ...(error ? { error } : {}) },
    parts: [{ type: 'text', text }],
  };
}

// 1. Identical fetch: array identity AND every record reference preserved.
const before = [record('m-1', 'first'), record('m-2', 'second')];
const identical = [record('m-1', 'first'), record('m-2', 'second')];
const sameMerge = mergeSessionMessageRecords(before, identical);
assert.equal(sameMerge, before, 'identical fetch must preserve array identity');
assert.equal(sameMerge[0], before[0]);
assert.equal(sameMerge[1], before[1]);

// 2. Changed parts: changed index adopts the new record, siblings keep refs.
const changedContent = [record('m-1', 'first'), record('m-2', 'second, now longer')];
const contentMerge = mergeSessionMessageRecords(before, changedContent);
assert.notEqual(contentMerge, before, 'changed content must break array identity');
assert.equal(contentMerge[0], before[0], 'unchanged sibling keeps its record ref');
assert.equal(contentMerge[1], changedContent[1]);
assert.equal(contentMerge[1].parts[0].text, 'second, now longer');

// 3. Changed info only (post-hoc error with identical parts): new record adopted.
const errored = [record('m-1', 'first'), record('m-2', 'second', 'stream failed')];
const errorMerge = mergeSessionMessageRecords(before, errored);
assert.notEqual(errorMerge, before);
assert.equal(errorMerge[0], before[0]);
assert.equal(errorMerge[1], errored[1], 'info-only change must adopt the new record');
assert.equal(errorMerge[1].info.error, 'stream failed');

// 4. Appended message: prior refs preserved, appended record present.
const appended = [...identical, record('m-3', 'third')];
const appendMerge = mergeSessionMessageRecords(before, appended);
assert.notEqual(appendMerge, before);
assert.equal(appendMerge[0], before[0]);
assert.equal(appendMerge[1], before[1]);
assert.equal(appendMerge[2].info.id, 'm-3');

// 5. Removed message: remaining refs preserved in order.
const removed = [record('m-1', 'first')];
const removeMerge = mergeSessionMessageRecords(before, removed);
assert.notEqual(removeMerge, before);
assert.equal(removeMerge.length, 1);
assert.equal(removeMerge[0], before[0]);

// 6. Reordered messages: fetched order wins even when contents are unchanged.
// Regression for the review finding: identity preservation must verify the
// record at every index, not just per-ID content equality.
const reordered = [record('m-2', 'second'), record('m-1', 'first')];
const reorderMerge = mergeSessionMessageRecords(before, reordered);
assert.notEqual(reorderMerge, before, 'reordered fetch must NOT reuse the stale array');
assert.deepEqual(reorderMerge.map((entry) => entry.info.id), ['m-2', 'm-1'], 'fetched order wins');
assert.equal(reorderMerge[0], before[1], 'record refs are still preserved per message');

// 7. Duplicate and unexpected IDs: deterministic, no stale-ref mixing.
const duplicateAndNew = [record('m-1', 'first'), record('m-1', 'first'), record('m-9', 'unknown')];
const mixedMerge = mergeSessionMessageRecords(before, duplicateAndNew);
assert.notEqual(mixedMerge, before);
assert.equal(mixedMerge[0], before[0]);
assert.equal(mixedMerge[1], before[0], 'duplicate ID reuses the prior ref deterministically');
assert.equal(mixedMerge[2], duplicateAndNew[2], 'unexpected ID adopts the fetched record');

// 8. Empty previous: the fetched array is adopted as-is.
const emptyPrevious = [];
const fresh = [record('m-1', 'first')];
assert.equal(mergeSessionMessageRecords(emptyPrevious, fresh), fresh);
const emptyNext = [];
assert.equal(mergeSessionMessageRecords(emptyPrevious, emptyNext), emptyNext, 'empty previous adopts the fetched array as-is');

// 9. Transcript entry cache integration: a preserved record ref returns the
// exact same cached entry object, skipping re-tokenization.
const entryBefore = toTranscriptEntry(before[0]);
const entryAfterContentMerge = toTranscriptEntry(contentMerge[0]);
assert.equal(entryAfterContentMerge, entryBefore, 'preserved ref reuses the cached transcript entry');
const entryAfterErrorMerge = toTranscriptEntry(errorMerge[0]);
assert.equal(entryAfterErrorMerge, entryBefore);

// Bench mode (not a CI gate): `node tests/record-preservation.test.mjs --bench`
if (process.argv.includes('--bench')) {
  const size = 200;
  const iterations = 200;
  const base = Array.from({ length: size }, (_, index) => record(`m-${index}`, `content ${index}`));
  const oneChange = [...base.slice(0, size - 1), record(`m-${size - 1}`, 'changed')];
  const reshuffled = [base[size - 1], ...base.slice(0, size - 1)];

  for (const [label, next] of [['identical', base], ['one-change', oneChange], ['reordered', reshuffled]]) {
    const started = performance.now();
    for (let run = 0; run < iterations; run += 1) {
      mergeSessionMessageRecords(base, next);
    }
    const elapsed = (performance.now() - started) / iterations;
    console.log(`merge ${label}: ${elapsed.toFixed(3)} ms/iteration (${size} records)`);
  }
}

console.log('record preservation tests passed');
