// Test file with top-level await
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Top-level await - now supported with async IIFE wrapper
await delay(100);

console.log('Top-level await completed');

