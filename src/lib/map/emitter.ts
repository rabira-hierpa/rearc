type Listener<TPayload> = (payload: TPayload) => void;

/**
 * A minimal typed event emitter — the only "framework" the map core depends on.
 * `on` returns an unsubscribe function, which is exactly the contract
 * `useSyncExternalStore` expects on the React side.
 */
export class Emitter<TEvents extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEvents, Set<Listener<never>>>();

  on<TName extends keyof TEvents>(name: TName, listener: Listener<TEvents[TName]>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      set.delete(listener as Listener<never>);
    };
  }

  emit<TName extends keyof TEvents>(name: TName, payload: TEvents[TName]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    // Sets tolerate deletion during iteration, so listeners may safely
    // unsubscribe themselves mid-emit.
    for (const listener of set) {
      (listener as Listener<TEvents[TName]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
