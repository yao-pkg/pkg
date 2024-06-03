import { PkgOptions } from './types';

class Options {
  private options: PkgOptions;

  constructor() {
    this.options = {
      dictionary: {},
    };
  }

  public set(options: PkgOptions): void {
    this.options = { ...this.options, ...options };
  }

  public get(): PkgOptions {
    return this.options;
  }
}

const options = new Options();

export default options;
