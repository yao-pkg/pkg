'use strict';

// Packaged into a SEA on top of a custom base Node binary (the host's own node,
// supplied via --sea-node-path or PKG_NODE_PATH). Output is asserted by main.js;
// process.pkg confirms the enhanced SEA bootstrap is active.
console.log('custom-node SEA OK:' + (process.pkg != null));
