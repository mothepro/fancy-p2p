/** Creates a promise that resolves in the specified number of milliseconds. */
export default (ms: number) => new Promise(ok => setTimeout(ok, ms))
