// A tiny store: one object holds the app state, and subscribers re-render
// whenever it changes. Keeping state in one place is what stops many windows
// updating at once (messages, presence, calls) from turning into spaghetti.

export function createStore(initial) {
  let state = { ...initial };
  const subscribers = new Set();

  return {
    get: () => state,

    // set({ key: value })  or  set((state) => ({ key: value }))
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      for (const fn of subscribers) fn(state);
    },

    // Returns an unsubscribe function.
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
