// Test file with multiple unsupported ESM features
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Top-level await
await delay(50);

// import.meta usage
console.log('Module URL:', import.meta.url);

// Top-level for-await-of
async function* generateItems() {
  yield 'a';
  yield 'b';
}

for await (const item of generateItems()) {
  console.log('Item:', item);
}

console.log('ok with multiple features');

