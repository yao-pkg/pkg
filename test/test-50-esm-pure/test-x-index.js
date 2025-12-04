'use strict';

// This test tries to import a pure ESM package
// nanoid is a pure ESM package since v4.0.0
try {
  // Try to require a pure ESM module - this should fail
  const { nanoid } = require('nanoid');
  const id = nanoid();
  console.log(`Generated ID: ${id}`);
  console.log('ok');
} catch (error) {
  console.error('Error:', error.message);
  // Expected error for pure ESM: "require() of ES Module ... not supported"
  if (
    error.message.includes('not supported') ||
    error.message.includes('ERR_REQUIRE_ESM')
  ) {
    console.log('Expected ESM error occurred');
    process.exit(0);
  }
  throw error;
}
