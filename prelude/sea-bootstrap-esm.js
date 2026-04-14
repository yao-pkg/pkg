// SEA Bootstrap (ESM) — used when the entrypoint is ESM AND the target
// Node.js supports sea-config mainFormat:"module" (Node >= 25.7).
//
// This file is the SEA `main` when mainFormat is "module". It statically
// imports the CJS setup core (esbuild bundles both into a single ESM
// file via CJS→ESM interop) and then uses native dynamic import() to
// load the user entrypoint — which properly supports top-level await
// and sync-require of ESM deps through the module loader.

import { pathToFileURL } from 'url';
import core from './sea-bootstrap-core.js';

try {
  await import(pathToFileURL(core.entrypoint).href);
} catch (err) {
  console.error(err);
  process.exit(1);
}
