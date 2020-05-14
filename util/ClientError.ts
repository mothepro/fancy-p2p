import Client from '../src/Client.js'

/** An error caused by a client. */
export default class extends Error {
  constructor(readonly message: string, readonly client?: Client) {
    super(message)
  }
}
