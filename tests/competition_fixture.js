/* Browser-only Firestore fixture: real competition repository/provider, no remote SDK. */
(() => {
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const key = '__bunsu_browser_competition_db';
  const documents = new Map(JSON.parse(sessionStorage.getItem(key) || '[]'));
  const listeners = new Set();
  const fixture = globalThis.__competitionFixture = {
    documents, listeners, operations: [], offset: 0, failWrites: false,
    emit() { for (const callback of [...listeners]) callback(); },
    persist() { sessionStorage.setItem(key, JSON.stringify([...documents])); },
    snapshot(ref) { return { id: ref.id, exists: documents.has(ref.path), data: () => clone(documents.get(ref.path)) }; }
  };
  let queue = Promise.resolve();
  const merged = (old, value, merge) => {
    const next = merge ? { ...old } : {};
    for (const [field, item] of Object.entries(value)) next[field] = item && typeof item === 'object' && '__increment' in item ? (old?.[field] ?? 0) + item.__increment : item;
    return next;
  };
  const db = {
    batch() {
      const writes = [];
      return {
        set(ref, value, options) { writes.push({ ref, value: clone(value), options }); },
        async commit() {
          await queue;
          if (fixture.failWrites) throw new Error('Test database unavailable');
          for (const { ref, value, options } of writes) { fixture.operations.push(['set', ref.path]); documents.set(ref.path, merged(documents.get(ref.path), value, options?.merge)); }
          if (writes.length) { fixture.persist(); fixture.emit(); }
        }
      };
    },
    collection(name) {
      return {
        doc(id) {
          const ref = { id, path: `${name}/${id}`, get: async () => fixture.snapshot(ref),
            onSnapshot(callback) { const run = () => callback(fixture.snapshot(ref)); listeners.add(run); run(); return () => listeners.delete(run); } };
          return ref;
        },
        orderBy(field, direction) {
          if (field !== 'score' || direction !== 'desc') throw new Error('Unexpected ranking query');
          const query = (limit = Infinity) => ({ onSnapshot(callback) {
            const run = () => callback({ docs: [...documents.keys()].filter(path => path.startsWith(`${name}/`))
              .map(path => ({ id: path.slice(name.length + 1), data: () => clone(documents.get(path)) }))
              .sort((a, b) => b.data().score - a.data().score).slice(0, limit) });
            listeners.add(run); run(); return () => listeners.delete(run);
          } });
          return { onSnapshot: query().onSnapshot, limit: query };
        }
      };
    },
    runTransaction(callback) {
      const run = queue.then(async () => {
        if (fixture.failWrites) throw new Error('Test database unavailable');
        const writes = [];
        const result = await callback({
          async get(ref) {
            if (writes.length) throw new Error('Firestore reads must precede writes');
            fixture.operations.push(['get', ref.path]); return fixture.snapshot(ref);
          },
          set(ref, value, options) { writes.push({ ref, value: clone(value), options }); }
        });
        for (const { ref, value, options } of writes) {
          fixture.operations.push(['set', ref.path]);
          documents.set(ref.path, merged(documents.get(ref.path), value, options?.merge));
        }
        if (writes.length) { fixture.persist(); fixture.emit(); }
        return result;
      });
      queue = run.catch(() => {}); return run;
    }
  };
  let competition;
  Object.defineProperty(globalThis, 'WeeklyCompetition', {
    configurable: true, get: () => competition,
    set(api) {
      const clock = () => new Date(Date.now() + fixture.offset);
      fixture.provider = api.createFirestoreProvider(db, { clock, increment: value => ({ __increment: value }) });
      competition = { ...api, ...api.createRepository({ onlineProvider: fixture.provider, clock }) };
    }
  });
})();
