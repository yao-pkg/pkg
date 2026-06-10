'use strict';

// Packaged into a SEA with `--sea-use-local-node`, so the embedded runtime is
// the same Node that ran pkg (rather than a downloaded one). Output is asserted
// by main.js. process.pkg confirms the enhanced SEA bootstrap is active.
console.log('local-node SEA OK:' + (process.pkg != null));
