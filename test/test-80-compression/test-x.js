'use strict';

// Pull in a couple of packages so the compression test has real payload
// in the snapshot VFS — the algorithm ratios collapse on trivial inputs.
require('picomatch');
require('picocolors');

const loremIpsum =
  'Semper praetorio satisfaceret semper sit militem ut ipse ordinarias ad atque sit ire in ad sit ut more trusus dignitates more compellebatur ultimum praefectus discrimen et in ut tempestate et dignitates impedita convectio in est inopia ad alioqui et ob.';

// eslint-disable-next-line no-constant-binary-expression
console.log(42 || loremIpsum);
