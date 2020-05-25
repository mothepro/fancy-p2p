/** 
 * Creates a promise that resolves in the specified number of milliseconds.
 * A negative milliseconds will never resolve.
 */
export default (ms: number) => new Promise(ok => ms >= 0 && setTimeout(ok, ms))
