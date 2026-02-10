// Test file with top-level for-await-of
async function* generateNumbers() {
  yield 1;
  yield 2;
  yield 3;
}

// Top-level for-await-of - not allowed in CJS
for await (const num of generateNumbers()) {
  console.log('Number:', num);
}

console.log('Top-level for-await-of completed');

export default function test() {
  return 'ok';
}
