import type { ActiveSetup, ActiveSetupPort } from "@/core/application/ports/active-setup-port";

const TTL_MS = 15_000;
const MAX_KEYS = 256;

function waitForRead<T>(value: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return value;
  return new Promise<T>((resolve, reject) => {
    const abort = () => { reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    value.then((result) => {
      signal.removeEventListener("abort", abort); resolve(result);
    }, (error: unknown) => {
      signal.removeEventListener("abort", abort); reject(error);
    });
  });
}

function sharedReads<T>(now: () => number) {
  const entries = new Map<string, { expires: number; value: Promise<T> }>();
  return {
    clear: () => entries.clear(),
    async read(key: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      signal?.throwIfAborted();
      let entry = entries.get(key);
      if (!entry || entry.expires <= now()) {
        if (entries.size >= MAX_KEYS) {
          const oldest = entries.keys().next().value;
          if (oldest !== undefined) entries.delete(oldest);
        }
        const created = { expires: Infinity, value: Promise.resolve().then(work) };
        entry = created;
        entries.set(key, created);
        created.value.then(() => { created.expires = now() + TTL_MS; }, () => {
          if (entries.get(key) === created) entries.delete(key);
        });
      }
      const result = await waitForRead(entry.value, signal);
      signal?.throwIfAborted();
      return structuredClone(result);
    },
  };
}

export function createSharedSetupReads(source: ActiveSetupPort, now = Date.now) {
  const active = sharedReads<ActiveSetup[]>(now);
  const selected = sharedReads<ActiveSetup | null>(now);
  const clear = () => { active.clear(); selected.clear(); };
  const loadPublished = source.loadPublished?.bind(source);
  const store: ActiveSetupPort = {
    ...source,
    loadActive(symbols, signal) {
      const key = JSON.stringify([...new Set(symbols)].sort());
      return active.read(key, () => source.loadActive(symbols, AbortSignal.timeout(25_000)), signal);
    },
    ...(loadPublished ? { loadPublished(symbol: string, signature: string, signal?: AbortSignal) {
      return selected.read(JSON.stringify([symbol, signature]), () => loadPublished(symbol, signature, AbortSignal.timeout(25_000)), signal);
    } } : {}),
    async persist(setups, signal) {
      clear();
      try { await source.persist(setups, signal); }
      finally { clear(); }
    },
  };
  return { store, clear };
}
