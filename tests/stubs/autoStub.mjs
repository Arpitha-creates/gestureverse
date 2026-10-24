/**
 * Universal stub used by the boot smoke test.
 *
 * Returns a Proxy that can be called, constructed, indexed and assigned to,
 * so it satisfies every Three.js / MediaPipe usage shape without needing a
 * hand-written fake for each class.
 */

export function stub(name = 'stub') {
  const target = function () {};
  const cache = new Map();

  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === Symbol.iterator) return undefined;
      if (prop === 'then') return undefined;
      if (prop === '__stub') return name;
      if (prop === 'toString') return () => `[${name}]`;
      if (cache.has(prop)) return cache.get(prop);
      if (prop in t) return t[prop];
      const child = stub(`${name}.${String(prop)}`);
      cache.set(prop, child);
      return child;
    },
    set(t, prop, value) {
      t[prop] = value;
      return true;
    },
    apply() {
      return stub(`${name}()`);
    },
    construct() {
      return stub(`new ${name}`);
    },
    has() {
      return true;
    },
  });

  return proxy;
}

export default stub;
