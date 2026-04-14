console.log('before-tla');

// Top-level await — only works because the CJS bootstrap uses dynamic
// import() for ESM entries (or mainFormat:"module" on Node >= 25.7).
const value = await Promise.resolve(42);

console.log('after-tla:' + value);
