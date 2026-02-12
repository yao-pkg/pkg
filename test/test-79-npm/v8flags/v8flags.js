'use strict';

var cp = require('child_process');

require('module')._extensions['.json'] = function () {
  throw new Error('prevent loading json cache');
};

var execFileCalled = false;
var execFileSave = cp.execFile;

cp.execFile = function () {
  execFileCalled = true;
  execFileSave.apply(cp, arguments);
};

setTimeout(function () {
  var v8flags = require('v8flags');
  v8flags(function (error, results) {
    if (error) return;
    if (!Array.isArray(results)) return;
    if (results.length < 6) return;
    if (!execFileCalled) return;
    console.log('ok');
  });
}, 500);
