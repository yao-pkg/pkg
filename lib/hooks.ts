import { spawn } from 'child_process';
import { readFile } from 'fs/promises';

import { log, wasReported } from './log';
import { STORE_BLOB, STORE_CONTENT } from './common';
import type {
  FileRecords,
  PkgOptions,
  PostBuildHook,
  PreBuildHook,
  TransformHook,
} from './types';

/**
 * Run a shell command synchronously to-completion. stdio is inherited so the
 * user sees their tool's output live; a non-zero exit (or spawn error) throws
 * a `wasReported` error so `exec()` aborts with the standard pkg error path.
 *
 * `extraEnv` is layered on top of `process.env` — used to expose `PKG_OUTPUT`
 * to `postBuild` shell hooks.
 */
async function runShell(
  command: string,
  extraEnv: NodeJS.ProcessEnv,
  hookName: string,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, {
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    });
    child.on('error', (err) => {
      rejectPromise(
        wasReported(`${hookName} hook failed to spawn: ${err.message}`),
      );
    });
    child.on('exit', (code, signal) => {
      if (code === 0) return resolvePromise();
      const reason = signal != null ? `signal ${signal}` : `exit code ${code}`;
      rejectPromise(
        wasReported(`${hookName} hook failed (${reason}): ${command}`),
      );
    });
  });
}

/**
 * Invoke `preBuild` if configured. Runs once before the walker, regardless
 * of pipeline (traditional, simple SEA, enhanced SEA).
 */
export async function runPreBuild(pkg: PkgOptions): Promise<void> {
  const hook = pkg.preBuild;
  if (hook === undefined) return;
  log.info('Running preBuild hook...');
  if (typeof hook === 'string') {
    await runShell(hook, {}, 'preBuild');
    return;
  }
  await (hook as PreBuildHook)();
}

/**
 * Invoke `postBuild` if configured. Called once per produced binary, after
 * it has been written and (where applicable) codesigned.
 *
 * Shell form receives the absolute output path via `PKG_OUTPUT`; function
 * form receives it as the first argument.
 */
export async function runPostBuild(
  pkg: PkgOptions,
  output: string,
): Promise<void> {
  const hook = pkg.postBuild;
  if (hook === undefined) return;
  log.info(`Running postBuild hook for ${output}`);
  if (typeof hook === 'string') {
    await runShell(hook, { PKG_OUTPUT: output }, 'postBuild');
    return;
  }
  await (hook as PostBuildHook)(output);
}

/**
 * Apply the `transform` hook to every record that ships file contents
 * (STORE_BLOB or STORE_CONTENT). Must run after the refiner (so paths are
 * final) and before bytecode generation / compression (so the transformed
 * source feeds those steps).
 *
 * Bodies are loaded eagerly when the user opts into transform — without
 * loading, packer/sea-assets would re-read disk and bypass the transform.
 * This trades memory for correctness; the cost only applies to builds that
 * configure a transform.
 */
export async function runTransform(
  pkg: PkgOptions,
  records: FileRecords,
): Promise<void> {
  const fn = pkg.transform;
  if (fn === undefined) return;
  log.info('Running transform hook...');

  for (const snap of Object.keys(records)) {
    const record = records[snap];
    if (!record) continue;
    if (!record[STORE_BLOB] && !record[STORE_CONTENT]) continue;

    let body: Buffer | string;
    if (record.body !== undefined) {
      body = record.body;
    } else {
      try {
        body = await readFile(record.file);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw wasReported(
          `transform hook: failed to read "${record.file}": ${reason}`,
        );
      }
    }

    let result: string | Buffer | void | undefined;
    try {
      result = await (fn as TransformHook)(record.file, body);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw wasReported(`transform hook threw for "${record.file}": ${reason}`);
    }

    if (result === undefined) {
      // User opted not to change this file. Cache the body we just loaded
      // so packer/sea-assets don't re-read the same bytes from disk.
      record.body = body;
      continue;
    }
    if (typeof result !== 'string' && !Buffer.isBuffer(result)) {
      throw wasReported(
        `transform hook for "${record.file}" returned ${typeof result}; ` +
          `expected string, Buffer, or undefined`,
      );
    }
    record.body = result;
  }
}
