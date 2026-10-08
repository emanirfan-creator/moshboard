// A small async cache: the newest `max` results by key, and callers asking for a key that's still
// being worked out share that one job instead of each starting their own.
export function remember<T>(max: number) {
  const done = new Map<string, T>()
  const running = new Map<string, Promise<T>>()
  return (key: string, make: () => Promise<T>): Promise<T> => {
    if (done.has(key)) {
      const v = done.get(key)!
      // Most recently used goes to the back; the oldest is dropped first.
      done.delete(key)
      done.set(key, v)
      return Promise.resolve(v)
    }
    let job = running.get(key)
    if (!job) {
      job = make()
        .then((v) => {
          done.set(key, v)
          if (done.size > max) done.delete(done.keys().next().value!)
          return v
        })
        .finally(() => running.delete(key))
      running.set(key, job)
    }
    return job
  }
}
