export default class <T> extends Set<T> {

  /** A string which will always be made with the given values in this set. */
  get hash() {
    return [...this].sort().join()
  }
}
