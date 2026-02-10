'use strict';

// Test uuid package version >= 10
const { v4, v1, validate, version, parse, stringify } = require('uuid');

// Test v4 (random UUID)
const uuidv4 = v4();
if (typeof uuidv4 !== 'string' || uuidv4.length !== 36) {
  throw new Error('UUID v4 generation failed');
}

// Test v1 (timestamp-based UUID)
const uuidv1 = v1();
if (typeof uuidv1 !== 'string' || uuidv1.length !== 36) {
  throw new Error('UUID v1 generation failed');
}

// Test validation
const isValid = validate(uuidv4);
if (!isValid) {
  throw new Error('UUID validation failed');
}

// Test version detection
const versionNum = version(uuidv4);
if (versionNum !== 4) {
  throw new Error('UUID version detection failed');
}

// Test parse functionality
const parsed = parse(uuidv4);
if (!parsed || parsed.length !== 16) {
  throw new Error('UUID parse failed');
}

// Test stringify functionality
const stringified = stringify(parsed);
if (stringified !== uuidv4) {
  throw new Error('UUID stringify failed');
}

console.log('ok');
