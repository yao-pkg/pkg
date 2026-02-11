// Test file with top-level await AND import statements
import { setTimeout } from 'timers/promises';

// Top-level await with imports should work
await setTimeout(100);

console.log('Top-level await with imports completed');

// Also test for-await-of at top level with imports
async function* generateData() {
  yield 'item1';
  yield 'item2';
  yield 'item3';
}

for await (const item of generateData()) {
  console.log(`Item: ${item}`);
}

console.log('For-await-of with imports completed');
