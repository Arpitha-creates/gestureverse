/**
 * Module resolve hook: swaps the two browser-only dependencies for stubs so
 * the application module graph can be loaded and exercised under Node.
 */

const MAP = {
  three: new URL('./stubs/three.mjs', import.meta.url).href,
  '@mediapipe/tasks-vision': new URL('./stubs/mediapipe.mjs', import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (MAP[specifier]) {
    return { url: MAP[specifier], shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
