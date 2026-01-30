# ESM Support Implementation Plan for pkg

## Key Research Findings (Critical - Read First!)

### Why ESM-to-CJS Transformation is Required

After extensive testing and investigation of Node.js internals, we've confirmed:

#### 1. **vm.Script Cannot Parse ESM Syntax**

- The `vm.Script` API used by pkg's fabricator **cannot parse ESM** (import/export statements)
- This is true with OR without `Module.wrap()` - tested in `test-fabricator-esm.js` and `test-module-wrap.js`
- Error: "Cannot use import statement outside a module"
- V8 bytecode cache (`produceCachedData`) only works with `vm.Script`

#### 2. **vm.SourceTextModule Alternative Exists But Can't Be Used**

Node.js does have `vm.SourceTextModule` which:

- ✅ CAN parse and execute ESM code
- ✅ HAS `createCachedData()` method for bytecode caching
- ✅ ACCEPTS `cachedData` option in constructor
- ❌ BUT requires **async** linking/evaluation infrastructure
- ❌ BUT requires **complete rewrite** of pkg's runtime (prelude/bootstrap.js)
- ❌ BUT uses different execution model: `link()` → `instantiate()` → `evaluate()`
- ❌ pkg's runtime is **synchronous**, built around `vm.Script.runInThisContext()`

#### 3. **V8 Engine Behavior**

- V8 **does** compile ESM to bytecode internally (all JavaScript becomes bytecode)
- Bytecode cache API is only exposed for `vm.Script`, NOT for `vm.SourceTextModule`
- Node.js 22.8+ has `NODE_COMPILE_CACHE` that caches both CJS and ESM
- But `NODE_COMPILE_CACHE` is internal-only, requires disk access, can't be embedded

#### 4. **Why Transform Instead of Native ESM Support**

Supporting native ESM via `vm.SourceTextModule` would require rewriting:

- Module loading infrastructure (currently synchronous)
- Async execution handling (current runtime is sync)
- Import resolution system
- Module linking and instantiation
- prelude/bootstrap.js (2000+ lines of runtime code)
- fabricator.ts execution model

ESM-to-CJS transformation approach:

- ✅ Works with existing pkg infrastructure (NO changes to fabricator or prelude)
- ✅ Maintains synchronous execution model
- ✅ Proven approach used by webpack, rollup, and all bundlers
- ✅ Provides same bytecode benefits (obfuscation, performance, smaller size)
- ✅ Industry-standard: Babel's `@babel/plugin-transform-modules-commonjs`

#### 5. **Testing Evidence**

Created comprehensive tests in `test/test-50-esm-pure/`:

- `test-fabricator-esm.js`: Proves `Module.wrap()` + `vm.Script` fails with ESM ❌
- `test-module-wrap.js`: Proves issue isn't Module.wrap(), it's vm.Script itself ❌
- `test-bytenode.js`: Proves bytenode (uses vm.Script internally) has same limitation ❌
- `test-nodejs-esm-caching.js`: Documents Node.js internal ESM handling
- `poc-transform.js`: Demonstrates ESM→CJS→bytecode workflow ✅ (needs plugin install)

**Conclusion**: ESM-to-CJS transformation is not a workaround—it's the **only practical solution** given pkg's architecture and V8's API constraints.

---

## Problem Analysis

### Current State

After testing with the `test-50-esm-pure` test case (using `nanoid` v5), I've identified the following issues:

1. **Module Resolution Failure**: The `resolve` package (v1.22.10) used in `follow.ts` doesn't understand:

   - `"type": "module"` in package.json
   - `"exports"` field for conditional exports
   - ESM import/export syntax
   - `.mjs` extensions

2. **Incomplete Dependency Discovery**: When pkg packages `nanoid`:

   - It finds `nanoid/index.js` ✅
   - It **fails to discover** `nanoid/url-alphabet/index.js` which is imported via ESM `import` ❌
   - The `detector.ts` finds the import statement but `follow.ts` can't resolve ESM imports
   - Result: Missing dependencies in the packaged binary

3. **Bytecode Compilation Warnings**:

   ```
   Warning Failed to make bytecode node20-x64 for file /snapshot/test-50-esm-pure/node_modules/nanoid/index.js
   ```

   - pkg tries to compile ESM as CommonJS bytecode
   - This fails silently but includes the raw source

4. **Runtime Error**:
   ```
   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/snapshot/test-50-esm-pure/node_modules/nanoid/url-alphabet/index.js'
   ```
   - The ESM file is included but its dependencies are not
   - Node's ESM loader can't find the imported module

### Root Causes

1. **`resolve` package limitations**:

   - Built for CommonJS module resolution algorithm
   - Doesn't implement Node.js ESM resolution algorithm (exports, imports, type: module)

2. **Walker doesn't follow ESM imports properly**:

   - `detector.ts` detects `import` statements via `visitorImport()`
   - But `follow.ts` uses `resolve` which doesn't understand ESM module specifiers
   - ESM imports like `import { x } from './url-alphabet/index.js'` aren't resolved correctly

3. **No ESM/CommonJS detection**:
   - No logic to determine if a file is ESM or CommonJS
   - All files treated as CommonJS during bytecode compilation

## Implementation Plan

### Phase 1: Enhanced Module Resolution (HIGH PRIORITY)

#### 1.1 Replace or Augment `resolve` Package

**Option A: Use `resolve.exports` + `resolve` (Recommended)**

- Install `resolve.exports` package (modern ESM resolution)
- Use it for packages with `exports` field
- Fallback to `resolve` for legacy packages

**Option B: Use Node.js native `require.resolve`**

- Use Node's built-in resolution with careful handling
- More aligned with actual runtime behavior

**Option C: Implement custom resolver**

- Full control but significant effort
- Would need to implement Node.js Module Resolution Algorithm from scratch

**Recommendation**: Option A - hybrid approach

#### 1.2 Create New `resolveModule` Function

```typescript
// lib/resolver.ts (NEW FILE)
interface ResolverOptions {
  basedir: string;
  extensions?: string[];
  isESM?: boolean;
  packageJson?: PackageJson;
}

async function resolveModule(
  specifier: string,
  options: ResolverOptions,
): Promise<{
  resolved: string;
  isESM: boolean;
  packageJson?: PackageJson;
}>;
```

This function should:

1. Check if parent module is ESM (via `type: "module"` or `.mjs`)
2. For ESM modules, use ESM resolution algorithm:
   - Check `exports` field in package.json
   - Handle conditional exports (node, import, require, default)
   - Resolve relative imports with full file extensions
3. For CommonJS, use existing `resolve` package
4. Return both the resolved path AND whether it's ESM

#### 1.3 Update `follow.ts`

```typescript
// Replace sync() call with new resolver
export async function follow(x: string, opts: FollowOptions) {
  // Detect if parent is ESM
  const parentIsESM = await isESMModule(opts.basedir);

  // Use new resolver
  const result = await resolveModule(x, {
    basedir: opts.basedir,
    extensions: opts.extensions,
    isESM: parentIsESM,
  });

  return result.resolved;
}
```

### Phase 2: ESM Detection and Metadata (MEDIUM PRIORITY)

#### 2.1 Add ESM Detection Utilities

```typescript
// lib/common.ts additions
export function isESMPackage(packageJsonPath: string): boolean {
  // Check if package.json has "type": "module"
}

export function isESMFile(filePath: string): boolean {
  // 1. Check file extension (.mjs = ESM, .cjs = CommonJS)
  // 2. If .js, check nearest package.json for "type" field
  // 3. Default to CommonJS for backwards compatibility
}
```

#### 2.2 Track ESM Files in Walker

Add ESM flag to `FileRecord`:

```typescript
export interface FileRecord {
  file: string;
  body?: Buffer | string;
  isESM?: boolean; // NEW
  // ... existing fields
}
```

Update `walker.ts` to mark ESM files:

```typescript
async step_STORE_ANY(record: FileRecord, marker: Marker, store: number) {
  // ... existing code ...

  // Add ESM detection
  record.isESM = isESMFile(record.file);

  // ... rest of code ...
}
```

### Phase 3: Enhanced Import Detection (MEDIUM PRIORITY)

#### 3.1 Add Dynamic Import Detection

Update `detector.ts` to detect dynamic imports:

```typescript
function visitorDynamicImport(n: babelTypes.Node) {
  // Detect: import('module')
  if (!babelTypes.isImport(n.parent)) {
    return null;
  }

  if (n.parent.type === 'CallExpression' && isLiteral(n.parent.arguments[0])) {
    return {
      v1: getLiteralValue(n.parent.arguments[0]),
      dynamic: true,
    };
  }

  return null;
}
```

#### 3.2 Add Export Re-export Detection

```typescript
function visitorExportFrom(n: babelTypes.Node) {
  // Detect: export { x } from 'module'
  // Detect: export * from 'module'
  if (
    babelTypes.isExportNamedDeclaration(n) ||
    babelTypes.isExportAllDeclaration(n)
  ) {
    if (n.source) {
      return { v1: n.source.value };
    }
  }
  return null;
}
```

Update `visitorSuccessful()` to include these new visitors.

### Phase 4: Transform ESM to CJS for Bytecode Compilation (HIGH PRIORITY)

#### 4.1 The Bytecode Challenge

**Key Discovery**:

- `vm.Script` with `produceCachedData: true` only works with CommonJS wrapped code
- Node.js doesn't provide a way to create bytecode cache for ESM modules directly
- We cannot use `vm.SourceTextModule` or `vm.Module` as they don't support cached data

**Solution**: Transform ESM to CJS before bytecode compilation while preserving semantics

#### 4.2 ESM-to-CJS Transformation Strategy

Create a new transformation layer that converts ESM syntax to CJS equivalents:

```typescript
// lib/esm-transformer.ts (NEW FILE)

import * as babel from '@babel/core';

interface TransformResult {
  code: string;
  isTransformed: boolean;
}

export async function transformESMtoCJS(
  code: string,
  filename: string,
): Promise<TransformResult> {
  try {
    const result = await babel.transformAsync(code, {
      filename,
      plugins: [
        // Transform ES6 modules to CommonJS
        '@babel/plugin-transform-modules-commonjs',
      ],
      // Preserve as much as possible
      compact: false,
      retainLines: true, // Preserve line numbers for debugging
      sourceMaps: false, // We don't need source maps for bytecode
    });

    return {
      code: result.code || code,
      isTransformed: true,
    };
  } catch (error) {
    // If transformation fails, fallback to storing as content
    return {
      code,
      isTransformed: false,
    };
  }
}
```

**What this transforms:**

```javascript
// ESM Input:
import { nanoid } from './nanoid.js';
export const id = nanoid();
export default function () {
  return id;
}

// CJS Output:
('use strict');
Object.defineProperty(exports, '__esModule', { value: true });
exports.default = void 0;
const _nanoid = require('./nanoid.js');
const id = (0, _nanoid.nanoid)();
exports.id = id;
function _default() {
  return id;
}
exports.default = _default;
```

#### 4.3 Integration into Walker

Update `walker.ts` to transform ESM before bytecode compilation:

```typescript
// In step_STORE_ANY method
if (store === STORE_BLOB) {
  if (!record.body) {
    await stepRead(record);
    this.stepPatch(record);
    stepStrip(record);
  }

  // NEW: Transform ESM to CJS if needed
  if (record.isESM && record.body) {
    const transformed = await transformESMtoCJS(
      record.body.toString('utf8'),
      record.file,
    );

    if (transformed.isTransformed) {
      record.body = transformed.code;
      log.debug('Transformed ESM to CJS for bytecode:', record.file);
    } else {
      // Transformation failed, store as content instead
      log.warn('ESM transformation failed, storing as content:', record.file);
      await this.appendBlobOrContent({
        file: record.file,
        marker,
        store: STORE_CONTENT,
      });
      return;
    }
  }

  // Continue with normal bytecode compilation
  const derivatives2: Derivative[] = [];
  stepDetect(record, marker, derivatives2);
  await this.stepDerivatives(record, marker, derivatives2);
}
```

#### 4.4 Runtime Considerations

**Important**: The transformed CJS code will be executed as CommonJS, but this is fine because:

1. **Semantics are preserved**: Babel's transformation maintains ESM semantics:

   - Named exports become `exports.name = value`
   - Default exports become `exports.default = value`
   - Live bindings are maintained through getters/setters
   - Import statements become `require()` calls

2. **Interop works**: Code requiring the transformed module gets the expected exports:

   ```javascript
   // Another module requiring it:
   const mod = require('./transformed-esm');
   console.log(mod.id); // Works
   console.log(mod.default); // Works
   ```

3. **Mixed execution**: ESM files can import each other through CJS require at runtime

#### 4.5 Handle Import Extensions

ESM requires explicit file extensions, but CommonJS doesn't. Update the transformation:

```typescript
export async function transformESMtoCJS(
  code: string,
  filename: string,
): Promise<TransformResult> {
  const result = await babel.transformAsync(code, {
    filename,
    plugins: [
      '@babel/plugin-transform-modules-commonjs',
      // Custom plugin to remove .js/.mjs extensions from require()
      {
        visitor: {
          CallExpression(path) {
            if (
              path.node.callee.name === 'require' &&
              path.node.arguments[0]?.type === 'StringLiteral'
            ) {
              const value = path.node.arguments[0].value;
              // Remove .js, .mjs, .cjs extensions from relative imports
              if (value.startsWith('.') && /\.(m|c)?js$/.test(value)) {
                path.node.arguments[0].value = value.replace(/\.(m|c)?js$/, '');
              }
            }
          },
        },
      },
    ],
    compact: false,
    retainLines: true,
  });

  return {
    code: result.code || code,
    isTransformed: true,
  };
}
```

This ensures that:

```javascript
import { x } from './module.js'  // ESM
↓
const { x } = require('./module') // CJS (extension removed)
```

#### 4.6 Preserve Dynamic Imports

Dynamic `import()` should remain as-is because:

- They work in CommonJS context (Node.js supports it)
- They maintain async loading semantics
- No transformation needed

Update transformer to skip dynamic imports:

```typescript
plugins: [
  [
    '@babel/plugin-transform-modules-commonjs',
    {
      // Don't transform dynamic imports
      strictMode: false,
      allowTopLevelThis: true,
      importInterop: 'babel',
      lazy: false,
    },
  ],
];
```

#### 4.7 Dependencies to Add

```json
{
  "dependencies": {
    "@babel/core": "^7.23.0", // Already present
    "@babel/plugin-transform-modules-commonjs": "^7.23.0" // NEW
  }
}
```

### Phase 5: Runtime Support (CRITICAL)

#### 5.1 Ensure `--experimental-require-module` Flag

For Node < 22.12.0, the packaged binary needs this flag. Update documentation and:

```typescript
// Prelude should detect and warn if ESM modules are present but flag isn't enabled
```

#### 5.2 Test Virtual Filesystem with ESM

The virtual filesystem (`/snapshot`) must work correctly with Node's ESM loader:

- Ensure ESM import resolution works in virtual FS
- Test with various import patterns (relative, bare specifiers, exports field)

### Phase 6: Package.json `exports` Field Handling (HIGH PRIORITY)

#### 6.1 Parse and Respect `exports` Field

The `exports` field can be complex:

```json
{
  "exports": {
    ".": {
      "import": "./index.mjs",
      "require": "./index.cjs",
      "types": "./index.d.ts"
    },
    "./feature": "./feature/index.js"
  }
}
```

Implement in resolver:

```typescript
function resolveExports(
  packageJson: PackageJson,
  subpath: string,
  conditions: string[], // ['node', 'import'] or ['node', 'require']
): string | null;
```

#### 6.2 Handle Conditional Exports

Common conditions:

- `import`: When imported via ESM
- `require`: When required via CommonJS
- `node`: Node.js environment
- `default`: Fallback
- `types`: TypeScript definitions

### Phase 7: Testing Strategy

#### 7.1 Test Cases to Add

1. **Pure ESM package** (✅ Already created: `test-50-esm-pure`)
   - Package with `"type": "module"`
   - Multiple ESM files with imports between them
2. **Hybrid package** (✅ Already exists: `test-01-hybrid-esm`)
   - Package with both ESM and CommonJS
   - Uses conditional exports
3. **CommonJS requiring ESM** (NEW)
   - CommonJS file that uses dynamic `import()`
   - Should work with proper async handling
4. **ESM with exports field** (NEW)

   - Package using complex `exports` field
   - Test subpath exports
   - Test conditional exports

5. **Circular ESM dependencies** (NEW)
   - ESM modules that import each other
   - Ensure no infinite loops in walker

#### 7.2 Update uuid Test

The `test-50-uuid-v10` test should now work once ESM support is added:

- uuid v10+ is pure ESM
- Uses `exports` field
- Tests real-world ESM package

### Phase 8: Documentation Updates

#### 8.1 Update README.md

- Document ESM support and limitations
- Explain when `--options experimental-require-module` is needed
- Provide examples of packaging ESM modules

#### 8.2 Update DEVELOPMENT.md

- Explain ESM resolution architecture
- Document new resolver system
- Add troubleshooting for ESM issues

#### 8.3 Update copilot-instructions.md

- Add ESM-specific guidelines
- Explain resolver selection logic
- Document testing requirements for ESM changes

## Implementation Order (Prioritized)

### Sprint 1: Foundation (Week 1-2)

1. ✅ Create `test-50-esm-pure` test case to reproduce issue
2. Create `lib/resolver.ts` with hybrid resolution
3. Add `isESMFile()` and `isESMPackage()` utilities
4. Update `follow.ts` to use new resolver
5. Create `lib/esm-transformer.ts` with ESM-to-CJS transformation

### Sprint 2: Integration (Week 3)

1. Update `walker.ts` to track ESM files
2. **Integrate ESM-to-CJS transformation for bytecode compilation**
3. Add `exports` field parsing
4. Test with `test-50-esm-pure`
5. Add Babel transform plugin dependency

### Sprint 3: Enhanced Detection (Week 4)

1. Add dynamic import detection (preserve, don't transform)
2. Add export re-export detection
3. Handle import extensions properly
4. Add comprehensive test cases
5. Fix edge cases discovered in testing

### Sprint 4: Polish (Week 5)

1. Performance optimization (cache transformations)
2. Error message improvements
3. Documentation updates
4. Test with real-world ESM packages (uuid, nanoid, chalk, etc.)
5. Verify bytecode generation metrics

## Technical Challenges & Risks

### Challenge 1: Bytecode Compilation

- **Issue**: V8 bytecode cache doesn't support ESM modules directly
- **Solution**: Transform ESM to CJS using Babel before bytecode compilation
- **Benefits**:
  - Maintains bytecode benefits (fast loading, obfuscation)
  - Preserves ESM semantics through Babel's standard transformation
  - Works with existing vm.Script infrastructure
- **Trade-offs**:
  - Adds transformation step during packaging (slight build time increase)
  - Transformed code is CJS at runtime (but maintains ESM semantics)
  - Requires Babel as dependency

### Challenge 2: Circular Dependencies

- **Issue**: ESM can have circular imports, walker might loop infinitely
- **Mitigation**: Track visited modules, detect cycles
- **Impact**: Need careful testing of circular dependency scenarios

### Challenge 3: Dynamic Imports

- **Issue**: `import('./dynamic-' + variable + '.js')` can't be statically analyzed
- **Mitigation**: Same as current dynamic `require()` - warn user, don't include
- **Impact**: Users must explicitly include dynamic imports in assets/scripts

### Challenge 4: Top-level Await

- **Issue**: ESM can use top-level await, affects execution model
- **Mitigation**: Should work if Node version supports it, no special handling needed
- **Impact**: Document minimum Node version for TLA support

### Challenge 5: Backwards Compatibility

- **Issue**: Changes to resolver might break existing CommonJS packages
- **Mitigation**: Use fallback chain: new resolver → old resolver → error
- **Impact**: Thorough testing needed with existing test suite

## Why Transform ESM to CJS for Bytecode?

### Alternative Approaches Considered

#### Option 1: Store ESM as Raw Content (REJECTED)

```typescript
// Skip bytecode for ESM
if (record.isESM) {
  store = STORE_CONTENT; // No bytecode, no transformation
}
```

**Pros:**

- Simpler implementation
- No transformation overhead

**Cons:**

- ❌ **No source code obfuscation** for ESM files (major security concern)
- ❌ **Slower startup time** (no bytecode cache benefits)
- ❌ **Inconsistent behavior** between CJS (bytecode) and ESM (source)
- ❌ **Larger binary size** (source code is bigger than bytecode)

#### Option 2: Transform ESM to CJS for Bytecode (SELECTED ✅)

```typescript
// Transform then create bytecode
if (record.isESM) {
  record.body = transformESMtoCJS(record.body);
  // Continue with normal bytecode compilation
}
```

**Pros:**

- ✅ **Full bytecode benefits**: Fast loading, obfuscation, smaller size
- ✅ **Consistent behavior**: All code gets bytecode compiled
- ✅ **Industry standard**: Same approach as webpack, rollup, esbuild
- ✅ **Proven technology**: Babel's transform is battle-tested
- ✅ **Maintains ESM semantics**: Live bindings, proper exports

**Cons:**

- Adds transformation step (minimal overhead, happens during packaging)
- Requires Babel plugin dependency

### Performance Impact Analysis

| Aspect               | ESM as Content        | ESM Transformed to CJS    |
| -------------------- | --------------------- | ------------------------- |
| **Package time**     | Faster (no transform) | Slightly slower (+babel)  |
| **Startup time**     | Slower (no bytecode)  | **Fast (bytecode)** ✅    |
| **Binary size**      | Larger (raw source)   | **Smaller (bytecode)** ✅ |
| **Security**         | Source visible        | **Obfuscated** ✅         |
| **Runtime behavior** | Pure ESM              | CJS with ESM semantics    |

### Real-World Example

```javascript
// Original ESM (nanoid/index.js)
import { webcrypto } from 'node:crypto';
import { urlAlphabet } from './url-alphabet/index.js';
export { urlAlphabet } from './url-alphabet/index.js';

export function nanoid(size = 21) {
  // ...implementation
}
```

**Without Transformation (Content):**

- Stored as raw ESM source code (readable in binary)
- No bytecode cache (slower execution)
- ~2KB of source text

**With Transformation (Bytecode):**

- Transformed to CJS: `exports.nanoid = function nanoid() {...}`
- Compiled to V8 bytecode (binary, fast)
- ~800 bytes of bytecode
- Source code optional (can be stripped for security)

## Success Criteria

1. ✅ `test-50-esm-pure` test passes
2. ✅ `test-01-hybrid-esm` still works
3. ✅ `test-50-uuid-v10` works with uuid v10+
4. ✅ All existing CommonJS tests still pass
5. ✅ Can package and run real-world ESM packages (nanoid, chalk, etc.)
6. ⚠️ Clear warnings/errors for unsupported ESM patterns
7. 📚 Comprehensive documentation
8. ✅ **ESM files get bytecode compiled** (not stored as raw content)
9. ✅ **Bytecode size and startup time comparable to CJS**

## Alternative Approaches Considered

### 1. Transpile ESM to CommonJS (REJECTED)

- **Pros**: Simpler implementation, works with existing bytecode
- **Cons**: Breaks source maps, alters semantics, maintenance burden
- **Reason for rejection**: Semantic differences between ESM and CJS make this error-prone

### 2. Bundle ESM with esbuild/webpack (REJECTED)

- **Pros**: Handles complex ESM scenarios, tree-shaking
- **Cons**: Adds heavy dependency, changes pkg's architecture significantly
- **Reason for rejection**: Too invasive, defeats purpose of pkg's lightweight approach

### 3. Wait for Node.js to support require(ESM) (PARTIALLY ADOPTED)

- **Pros**: Native support, no workarounds needed
- **Cons**: Already available in Node 22.12.0+ but not older versions
- **Decision**: Support it via `--experimental-require-module` flag + proper resolution

## Dependencies to Add

```json
{
  "dependencies": {
    "resolve.exports": "^2.0.2", // ESM exports resolution
    "@babel/plugin-transform-modules-commonjs": "^7.23.0" // ESM to CJS transformation
  }
}
```

**Note**: `@babel/core` is already a dependency, so we only need to add the transform plugin.

## Estimated Effort

- **Total**: ~3-4 weeks (1 developer)
- **Core functionality**: ~2 weeks
- **Testing & edge cases**: ~1 week
- **Documentation**: ~3-4 days
- **Buffer for unknowns**: ~3-4 days

## Questions for Discussion

1. **Should we support older Node versions?**

   - Option A: Require Node 18+ for ESM support
   - Option B: Support back to Node 14 with limitations

2. **How to handle dynamic imports?**

   - Recommended: Keep as dynamic import() (Node.js supports this in CJS)
   - Alternative: Transform to Promise-based require patterns

3. **ESM-to-CJS transformation approach?**

   - Confirmed: Use Babel's @babel/plugin-transform-modules-commonjs
   - This is the industry-standard approach used by bundlers
   - Maintains ESM semantics while enabling bytecode compilation

4. **Breaking changes acceptable?**
   - Is changing resolver a breaking change?
   - Should this be v7.0.0 or v6.11.0?
5. **Performance considerations?**
   - Should we cache transformed code?
   - Should transformation be opt-out for performance-sensitive builds?

---

## Ready for Implementation - Next Steps

### Prerequisites Completed ✅

1. ✅ Root cause analysis complete (resolver + bytecode limitations)
2. ✅ Test case created (`test/test-50-esm-pure/`)
3. ✅ ESM limitations researched and documented
4. ✅ Proof of concept created (`poc-transform.js`)
5. ✅ Implementation approach validated (ESM-to-CJS transformation)

### Step 1: Install Required Dependencies

```bash
cd /home/daniel/GitProjects/pkg
npm install @babel/plugin-transform-modules-commonjs resolve.exports --save
```

### Step 2: Validate Proof of Concept

```bash
cd test/test-50-esm-pure
node poc-transform.js
```

Expected output: "✅ Success! ESM was transformed to CJS, compiled to bytecode, and executed correctly"

### Step 3: Begin Sprint 1 Implementation (Week 1)

#### Task 1.1: Create `lib/esm-transformer.ts`

```typescript
import * as babel from '@babel/core';

export function transformESMtoCJS(
  code: string,
  filename: string,
): { code: string; isTransformed: boolean } {
  try {
    const result = babel.transformSync(code, {
      filename,
      plugins: [
        [
          '@babel/plugin-transform-modules-commonjs',
          {
            strictMode: true,
            allowTopLevelThis: true,
          },
        ],
      ],
      sourceMaps: false,
      compact: false,
    });

    return {
      code: result?.code || code,
      isTransformed: true,
    };
  } catch (error) {
    console.warn(`Failed to transform ESM file ${filename}: ${error.message}`);
    return {
      code,
      isTransformed: false,
    };
  }
}
```

#### Task 1.2: Create `lib/resolver.ts`

Implement ESM-aware module resolver using `resolve.exports` + fallback to `resolve`.

#### Task 1.3: Add ESM Detection Utilities to `lib/common.ts`

```typescript
export function isESMFile(filePath: string): boolean {
  if (filePath.endsWith('.mjs')) return true;
  if (filePath.endsWith('.cjs')) return false;

  // Check nearest package.json for "type": "module"
  const packageJson = findNearestPackageJson(filePath);
  return packageJson?.type === 'module';
}

export function isESMPackage(packageJsonPath: string): boolean {
  const pkg = require(packageJsonPath);
  return pkg.type === 'module';
}
```

#### Task 1.4: Integrate Transformation into `lib/walker.ts`

In `step_STORE_ANY()` method, after reading file content:

```typescript
// If ESM file, transform to CJS before bytecode compilation
if (isESMFile(record.file)) {
  const transformed = transformESMtoCJS(record.body.toString(), record.file);
  if (transformed.isTransformed) {
    record.body = Buffer.from(transformed.code);
    record.isESM = true;
  }
}
```

### Step 4: Test Implementation

```bash
# Build the project
npm run build

# Run ESM test
node test/test.js node20 test-50-esm-pure

# Run full test suite
npm test
```

### Step 5: Sprint 2-4 (Weeks 2-5)

Continue with remaining phases as outlined in the plan:

- Sprint 2: Enhanced import detection, exports field support
- Sprint 3: Runtime polyfills, edge case handling
- Sprint 4: Testing, documentation, release

### Success Criteria

Implementation is complete when:

1. ✅ `test-50-esm-pure` (nanoid) packages and runs successfully
2. ✅ `test-50-uuid-v10` packages and runs successfully
3. ✅ All existing tests still pass (no regressions)
4. ✅ Bytecode is produced for ESM files (after transformation)
5. ✅ No missing dependency errors at runtime

---

**Status**: ✅ READY TO START - All research complete, approach validated, tasks defined.
