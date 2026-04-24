// `import.meta` is only valid in `sourceType: "module"`. Before the fix for
// issue #264 the SEA walker parsed this body in script mode, so the parse
// failed and the detector never saw the imports below — neither the static
// one nor the dynamic one ended up in the snapshot.
import { greet } from './lib/helper.mjs';

const here = new URL(import.meta.url).pathname;
console.log('here:' + here.split('/').pop());
console.log('static:' + greet('world'));

const dyn = await import('./lib/dyn.mjs');
console.log('dynamic:' + dyn.shout('world'));
