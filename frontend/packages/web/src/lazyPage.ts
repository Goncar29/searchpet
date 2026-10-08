import { lazy } from 'react';
import type { ComponentType } from 'react';

/**
 * Code-splits a page that is a named export. `React.lazy` only takes a module
 * whose default export is the component, and every page here exports by name.
 *
 * Without this, App.tsx imported all ~45 pages eagerly, so the home shipped a
 * single 340 KB bundle of which it used about 130 KB, and nothing could paint
 * until all of it had downloaded and run (Lighthouse mobile, 2026-10-08:
 * ~4.9 s of LCP render delay).
 */
export function lazyPage<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}
