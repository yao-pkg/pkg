// Type definitions for resolve.exports
declare module 'resolve.exports' {
  export interface ResolveOptions {
    browser?: boolean;
    require?: boolean;
    conditions?: string[];
    unsafe?: boolean;
  }

  export function resolve(
    pkg: Record<string, unknown>,
    entry?: string,
    options?: ResolveOptions,
  ): string | string[] | undefined;

  export function exports(
    pkg: Record<string, unknown>,
    entry?: string,
    options?: ResolveOptions,
  ): string | string[] | undefined;

  export function imports(
    pkg: Record<string, unknown>,
    entry?: string,
    options?: ResolveOptions,
  ): string | string[] | undefined;

  export function legacy(
    pkg: Record<string, unknown>,
    options?: ResolveOptions,
  ): string | undefined;
}
