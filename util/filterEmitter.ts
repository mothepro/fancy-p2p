import { Listener } from 'fancy-emitter'

/** Resolves once the `emitter` activates with `value`. */
// TODO include in 'fancy-emitter'?
export default async function <T>(emitter: Listener<T>, value: T) {
  for await (const current of emitter)
    if (value == current)
      return
}
