type PollCallback<T> = (value: T) => void;

interface PollingWatcherOptions<T> {
  poll: () => Promise<T>;
  keyOf: (value: T) => string | null;
  resetKey: string | null | undefined;
}

interface PollingWatcher<T> {
  start: (callback: PollCallback<T>, intervalMs?: number) => void;
  stop: () => void;
}

export function createPollingWatcher<T>(options: PollingWatcherOptions<T>): PollingWatcher<T> {
  let currentKey = options.resetKey;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let generation = 0;

  function start(callback: PollCallback<T>, intervalMs = 1500): void {
    if (intervalId !== null) return;

    async function tick(): Promise<void> {
      const gen = ++generation;
      try {
        const value = await options.poll();
        if (gen !== generation) return;

        const newKey = options.keyOf(value);
        if (newKey !== currentKey) {
          currentKey = newKey;
          callback(value);
        }
      } catch {
        // Host may be busy or modal; skip this tick.
      }
    }

    void tick();
    intervalId = setInterval(() => {
      void tick();
    }, intervalMs);
  }

  function stop(): void {
    generation += 1;
    currentKey = options.resetKey;

    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  return { start, stop };
}
