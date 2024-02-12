import async, { AsyncOpts } from 'resolve';
import fs from 'fs';
import path from 'path';
import { toNormalizedRealPathAsync } from './common';

import type { PackageJson } from './types';

const PROOF = 'a-proof-that-main-is-captured.js';

function parentDirectoriesContain(parent: string, directory: string) {
  let currentParent = parent;

  while (true) {
    if (currentParent === directory) {
      return true;
    }

    const newParent = path.dirname(currentParent);

    if (newParent === currentParent) {
      return false;
    }

    currentParent = newParent;
  }
}

interface FollowOptions extends Pick<AsyncOpts, 'basedir' | 'extensions'> {
  ignoreFile?: string;
  catchReadFile?: (file: string) => void;
  catchPackageFilter?: (config: PackageJson, base: string, dir: string) => void;
}

export function follow(x: string, opts: FollowOptions) {
  return new Promise<string>((resolve, reject) => {
    async(
      x,
      {
        basedir: opts.basedir,
        extensions: opts.extensions,
        isFile: (file: string) => {
          if (
            opts.ignoreFile &&
            path.join(path.dirname(opts.ignoreFile), PROOF) === file
          ) {
            return true;
          }

          let stat;

          try {
            stat = fs.statSync(file);
          } catch (e) {
            const ex = e as NodeJS.ErrnoException;

            if (ex && (ex.code === 'ENOENT' || ex.code === 'ENOTDIR'))
              return false;

            throw ex;
          }

          return stat.isFile() || stat.isFIFO();
        },
        isDirectory: (directory) => {
          if (
            opts.ignoreFile &&
            parentDirectoriesContain(opts.ignoreFile, directory)
          ) {
            return false;
          }

          let stat;

          try {
            stat = fs.statSync(directory);
          } catch (e) {
            const ex = e as NodeJS.ErrnoException;

            if (ex && (ex.code === 'ENOENT' || ex.code === 'ENOTDIR')) {
              return false;
            }

            throw ex;
          }

          return stat.isDirectory();
        },
        readFile: (file) => {
          if (opts.ignoreFile && opts.ignoreFile === file) {
            return Promise.resolve(Buffer.from(`{"main":"${PROOF}"}`));
          }

          if (opts.catchReadFile) {
            opts.catchReadFile(file);
          }

          return fs.promises.readFile(file);
        },
        packageFilter: (config, base, dir) => {
          if (opts.catchPackageFilter) {
            opts.catchPackageFilter(config, base, dir);
          }

          return config;
        },

        /** function to synchronously resolve a potential symlink to its real path */
        // realpathSync?: (file: string) => string;
        realpath: async (file) => {
          const file2 = await toNormalizedRealPathAsync(file);
          return file2;
        },
      },
      (err, res) => {
        if (err) {
          reject(err);
        } else if (res === undefined) {
          reject(new Error(`Cannot find module '${x}'`));
        } else {
          resolve(res);
        }
      },
    );
  });
}
