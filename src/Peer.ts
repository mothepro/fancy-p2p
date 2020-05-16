import { SingleEmitter, Emitter, Listener } from 'fancy-emitter'
import type { Name } from '@mothepro/signaling-lobby'
import RTC, { Sendable, State } from '@mothepro/ez-rtc'
import Client from './Client.js'
import delay from '../util/delay.js'
import filterEmitter from '../util/filterEmitter.js'

/** Represents a direct connection to a peer found in the signalling lobby. */
export interface SimplePeer<T = Sendable> {
  /** Name of the new peer. */
  readonly name: Name
  /** Send data to activate the `message` listener for the peer. */
  send(data: T): void
  /** Activates when a message is received for this peer. Cancels once the connection is closed. */
  readonly message: Listener<T>
}

// TODO support making connections until one is established.
export default class <T extends Sendable = Sendable> implements SimplePeer<T> {

  private rtc!: RTC

  readonly ready = new SingleEmitter(async () => {
    // @ts-ignore this will be okay since we know Sendable can be cast to T
    this.rtc.message.on(this.message.activate)

    try {
      await filterEmitter(this.rtc.statusChange, State.OFFLINE)
      this.message.cancel()
    } catch (err) {
      this.message.deactivate(err)
    }
  })

  // This cast okay, since T is a subclass of Sendable, and the type is only guaranteed through the generic
  message: Emitter<T> = new Emitter

  readonly name: Name

  send(data: T) {
    if (!this.message.isAlive)
      throw Error('Unable to send data when connection is not open')
    this.rtc.send(data)
  }

  constructor(stuns: string[], client: Client, retries = 1, timeout = 10 * 1000) {
    this.name = client.name
    this.makeRtc(stuns, client, retries, timeout)
      .then(this.ready.activate)
      .catch(err => {
        this.ready.deactivate(err)
        this.message.cancel() // Cancel now since no events will ever occur.
      })
  }

  private async makeRtc(stuns: string[], { isOpener, acceptor, creator }: Client, retries: number, timeout: number) {
    const reasons: Error[] = []

    for (let attempt = 0; attempt < retries; attempt++)
      try {
        this.rtc = new RTC(stuns)

        // Exchange the SDPs
        if (await isOpener.event) {
          // Openers should create offer -> accept answer
          creator.activate(await this.rtc.createOffer())
          this.rtc.acceptSDP(await acceptor.next)
        } else {
          // Closers should accept offter -> create answer
          this.rtc.acceptSDP(await acceptor.next)
          creator.activate(await this.rtc.createAnswer())
        }

        // TODO Simplify
        if (timeout)
          await Promise.race([
            delay(timeout).then(() => Promise.reject(Error(`Connection didn't become ready in ${timeout}ms`))),
            filterEmitter(this.rtc.statusChange, State.CONNECTED),
          ])
        else
          await filterEmitter(this.rtc.statusChange, State.CONNECTED)

        return // leave function behind... we are good :)
      } catch (err) {
        reasons.push(err)
      }

    // Aggregate error
    const err: Error & { reasons?: Error[] } = Error(`Unable to initializes a Direct Connection with ${name} after ${retries} attempts`)
    err.reasons = reasons
    throw err
  }
}
