// Test file with top-level for-await-of
async function* generateNumbers() {
  yield 1;
  yield 2;
  yield 3;
}

// Top-level for-await-of - now supported with async IIFE wrapper
for await (const num of generateNumbers()) {
  console.log('Number:', num);
}

console.log('Top-level for-await-of completed');

