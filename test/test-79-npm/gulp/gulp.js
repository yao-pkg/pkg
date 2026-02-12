'use strict';

var path = require('path');
process.env.NODE_PATH = (process.env.NODE_PATH || '')
  .split(path.delimiter)
  .filter((p) => p)
  .concat(__dirname + '/node_modules')
  .join(path.delimiter);
require('module')._initPaths();

require('gulp');
require('gulp-concat');
require('gulp/bin/gulp.js');
