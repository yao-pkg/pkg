# Test UUID v10+

This test verifies that the `uuid` package version >= 10.0.0 works correctly when packaged with pkg.

## What's being tested

UUID v10+ introduced an ESM-first approach with the following features being tested:

1. **UUID v4 (random)** - Most common usage, generates random UUIDs
2. **UUID v1 (timestamp-based)** - Generates UUIDs based on timestamp and MAC address
3. **validate()** - Validates UUID format
4. **version()** - Detects UUID version from string
5. **parse()** - Converts UUID string to byte array
6. **stringify()** - Converts byte array back to UUID string

## Running the test

```bash
# Install dependencies first
cd test-50-uuid-v10
npm install

# Run test with default (host) target
cd ..
node test/test.js host no-npm test-50-uuid-v10

# Or run directly
cd test-50-uuid-v10
node main.js
```

## Notes

- UUID v10+ requires Node.js 14+
- For Node.js versions < 22.12.0, ESM modules may require `--options experimental-require-module`
- This test uses destructured imports which is supported in uuid v10+
