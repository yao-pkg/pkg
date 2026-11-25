#!/usr/bin/env node

'use strict';

// yao-pkg/pkg#334: an explicit undefined/null options argument
var cp = require('child_process');

console.log('execSync null:', String(cp.execSync('echo sync', null)).trim());

cp.exec('echo undef', undefined, function (error, stdout) {
  if (error) return console.error(error);
  console.log('exec undefined:', stdout.trim());

  cp.exec('echo null', null, function (error2, stdout2) {
    if (error2) return console.error(error2);
    console.log('exec null:', stdout2.trim());
  });
});
