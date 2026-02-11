// Test file to verify import.meta properties work correctly
console.log('Testing import.meta properties...');

// Test import.meta.url
if (!import.meta.url) {
  console.error('FAIL: import.meta.url is not defined');
  process.exit(1);
}

if (!import.meta.url.startsWith('file://')) {
  console.error('FAIL: import.meta.url should start with file://');
  console.error('Got:', import.meta.url);
  process.exit(1);
}

console.log('✓ import.meta.url works:', import.meta.url);

// Test import.meta.dirname
if (typeof import.meta.dirname === 'undefined') {
  console.error('FAIL: import.meta.dirname is not defined');
  process.exit(1);
}

console.log('✓ import.meta.dirname works:', import.meta.dirname);

// Test import.meta.filename
if (typeof import.meta.filename === 'undefined') {
  console.error('FAIL: import.meta.filename is not defined');
  process.exit(1);
}

console.log('✓ import.meta.filename works:', import.meta.filename);

console.log('\n✅ All import.meta properties work correctly!');
