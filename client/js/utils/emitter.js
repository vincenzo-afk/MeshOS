/**
 * MeshOS Event Emitter
 * A minimal, dependency-free pub/sub base class used by every stateful
 * client module (WebRTC peer manager, socket wrapper, peer directory,
 * window manager, etc.) so the rest of the app can react to state changes
 * without polling.
 */

export class Emitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Registers a listener for `event`.
   * @param {string} event
   * @param {(...args:any[]) => void} handler
   * @returns {() => void} an unsubscribe function, for convenience
   */
  on(event, handler) {
    if (typeof handler !== 'function') return () => {};
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /** Registers a listener that automatically unsubscribes after one call. */
  once(event, handler) {
    const wrapped = (...args) => {
      this.off(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (!set) return;
    if (handler) {
      set.delete(handler);
      if (set.size === 0) this._listeners.delete(event);
    } else {
      this._listeners.delete(event);
    }
  }

  emit(event, ...args) {
    const set = this._listeners.get(event);
    if (!set || set.size === 0) return;
    // Snapshot so a handler that unsubscribes mid-emit doesn't corrupt iteration.
    for (const handler of Array.from(set)) {
      try {
        handler(...args);
      } catch (err) {
        console.error(`[MeshOS] listener for "${event}" threw`, err);
      }
    }
  }

  /** Removes every listener for every event on this emitter. */
  removeAllListeners() {
    this._listeners.clear();
  }

  listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }
}
