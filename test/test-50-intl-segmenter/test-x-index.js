'use strict';

// Guards nodejs/node#51752: pkg-fetch base binaries are built with
// small-icu and ship no ICU break-iterator data, where Intl.Segmenter
// constructs fine but segment() dereferences a null icu::BreakIterator
// and takes the process down with SIGSEGV. The prelude replaces
// segment() with a RangeError on such bases. Whichever branch applies,
// the process must survive.

const variables = process.config.variables;

// Recomputed independently of the prelude: data-less small-icu resolves
// every locale to the default one.
const hasBreakData =
  new Intl.DateTimeFormat('de').resolvedOptions().locale === 'de' &&
  new Intl.DateTimeFormat('ja').resolvedOptions().locale === 'ja';

console.log('BROKEN:' + (variables.icu_small === true && !hasBreakData));

const segmenter = new Intl.Segmenter();

try {
  console.log('SEGMENTED:' + [...segmenter.segment('⠋ hi ✔')].length);
} catch (error) {
  console.log('THREW:' + error.constructor.name);
}

console.log('ALIVE');
