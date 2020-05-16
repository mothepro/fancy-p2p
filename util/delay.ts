/** Creates a promise that rejects in the specified number of milliseconds. */
export default (ms: number) => new Promise((_, nok) => setTimeout(nok, ms)) as Promise<never>
