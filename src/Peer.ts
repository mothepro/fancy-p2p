import { SingleEmitter, Emitter, Listener, filterValue } from 'fancy-emitter'
import type { Name } from '@mothepro/signaling-lobby'
import RTC, { Sendable, State } from '@mothepro/ez-rtc'
import Client from './Client.js'
import delay from '../util/delay.js'

class ErrorWithReasons extends Error {
  constructor(
    readonly reasons: Error[],
    message?: string
  ) { super(message) }
}

/** Represents a direct connection to a peer found in the signalling lobby. */
export interface SimplePeer<T = Sendable> {
  /** Name of the new peer. */
  readonly name: Name
  /** Send data to activate the `message` listener for the peer. */
  send(data: T): void
  /** Activates when a message is received for this peer. Cancels once the connection is closed. */
  readonly message: Listener<Exclude<T, ArrayBufferView>>
  /**
   * Whether this peer represents a "connection" to you.
   * 
   * When false this is another peer and data is sent through the wire.
   */
  readonly isYou: boolean
}

/** Simple class that can be used as a local feedback peer. */
export class MockPeer<T extends Sendable = Sendable> implements SimplePeer<T> {
  readonly isYou = true
  readonly message: Emitter<Exclude<T, ArrayBufferView>> = new Emitter
  // Convert ArrayBufferView's to their raw buffer to match how it is over the wire.
  readonly send = (data: T) => this.message.activate(
    // @ts-ignore Type 'ArrayBuffer' **is** assignable to type 'Exclude<T, ArrayBufferView>' since T mustin include Buffers and their views together
    ArrayBuffer.isView(data)
      ? data.buffer
      : data)
  constructor(readonly name: Name) { }
}

// TODO support making connections until one is established.
export default class <T extends Sendable = Sendable> implements SimplePeer<T> {
  readonly isYou = false
  private rtc!: RTC
  readonly name: Name
  readonly message: Emitter<Exclude<T, ArrayBufferView>> = new Emitter

  readonly ready = new SingleEmitter(async () => {
    if (this.rtc.message.count)
      console.warn(this.rtc.message.count, 'messages have been sent through', this.name, 'p2p channel before listener was bound')

    // @ts-ignore This cast okay, since T is a subclass of Sendable, and the type is only guaranteed through the generic
    this.rtc.message.on(this.message.activate)

    try {
      await filterValue(this.rtc.statusChange, State.OFFLINE)
      this.message.cancel()
    } catch (err) {
      this.message.deactivate(err)
    }
  })

  readonly send = (data: T) => {
    if (!this.message.isAlive)
      throw Error('Unable to send data when connection is not open')
    this.rtc.send(data)
  }

  constructor(stuns: string[], client: Client, retries = 1, timeout = -1) {
    this.name = client.name
    this.makeRtc(stuns, client, retries, timeout)
  }

  private async makeRtc(stuns: string[], { isOpener, acceptor, creator }: Client, retries: number, timeout: number) {
    // This holds the errors thrown for the RTCs that were unable to be created.
    const reasons: Error[] = []

    for (let attempt = 0; attempt < Math.max(1, retries); attempt++)
      try {
        this.rtc = new RTC(stuns)

        // Set before exchange... this is important!
        const isConnected = filterValue(this.rtc.statusChange, State.CONNECTED)

        // Exchange the SDPs
        if (await isOpener.event) // Openers should create offer -> accept answer
          creator.activate(await this.rtc.createOffer())
        
        this.rtc.acceptSDP(await acceptor.next)

        if (!await isOpener.event) // Closers should accept offter -> create answer
          creator.activate(await this.rtc.createAnswer())

        // Wait until ready, or timeout if possible.
        await Promise.race([
          isConnected,
          delay(timeout).then(() => Promise.reject(Error(`Connection didn't become ready in ${timeout}ms`))),
        ])

        // leave function behind... we are good 😊
        this.ready.activate()
        return
      } catch (err) {
        reasons.push(err)
      }

    this.message.cancel() // Cancel early since no events will ever occur.
    this.ready.deactivate(new ErrorWithReasons(reasons, `Unable to initializes a Direct Connection with ${this.name} after ${retries} attempts`))
  }
}
