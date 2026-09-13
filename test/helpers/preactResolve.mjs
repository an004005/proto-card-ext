import { pathToFileURL } from 'node:url';
const MAP = {
  preact: new URL('../../vendor/preact.js', import.meta.url).href,
  'preact/hooks': new URL('../../vendor/preact-hooks.js', import.meta.url).href,
};
export function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  return next(specifier, context);
}
