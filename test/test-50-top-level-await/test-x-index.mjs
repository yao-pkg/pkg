// Test file with top-level await
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Top-level await should work with async IIFE wrapper
await delay(100);

console.log('Top-level await completed');

// Also test for-await-of at top level
async function* generateNumbers() {
  yield 1;
  yield 2;
  yield 3;
}

for await (const num of generateNumbers()) {
  console.log(`Number: ${num}`);
}

console.log('For-await-of completed');
