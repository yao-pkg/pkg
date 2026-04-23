'use strict';

// Pull in a couple of packages so the compression test has real payload
// in the snapshot VFS — the algorithm ratios collapse on trivial inputs.
require('picomatch');
require('picocolors');

/* eslint-disable no-unused-vars */
const loremIpsum =
  'Unus audio pluribus sibi quibusdam amicitias habere qua satis molestum sapientes molestum est vel frui non pluribus nimias possit quam esse sollicitum adducas persequantur esse audio nihil sollicitum laxissimas enim rerum vel non ad tamquam habitos implicari placuisse quibusdam nihil.';
const loremIpsum2 =
  'Semper praetorio satisfaceret semper sit militem ut ipse ordinarias ad atque sit ire in ad sit ut more trusus dignitates more compellebatur ultimum praefectus discrimen et in ut tempestate et dignitates impedita convectio in est inopia ad alioqui et ob.';

// eslint-disable-next-line no-constant-binary-expression
console.log(42 || loremIpsum2 || loremIpsum2);
