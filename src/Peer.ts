import { SingleEmitter, SafeListener } from 'fancy-emitter'
import type { Name } from '@mothepro/signaling-lobby'
import RTC, { Sendable, State } from '@mothepro/ez-rtc'
import Client from './Client.js'

/** Represents a direct connection to a peer found in the signalling lobby. */
export interface SimplePeer<T> {
  /** Name of the new peer. */
  readonly name: Name
  /** Send data to activate the `message` listener for the peer. */
  send(data: T): void
  /** Activates when a message is received for this peer. Cancels once the connection is closed. */
  readonly message: SafeListener<T>
}

// TODO support making connections until one is established.
export default class <T extends Sendable = Sendable> implements SimplePeer<T> {

  private readonly rtc = new RTC(this.stuns)

  readonly ready = new SingleEmitter

  // This is okay, since T is a subclass of Sendable, and the type is only guaranteed through the generic
  readonly message = this.rtc.message as unknown as SafeListener<T>

  readonly name: Name

  constructor(
    private readonly stuns: string[],
    client: Client,
  ) {
    this.name = client.name
    this.bindRtcStatus()
    this.exchangeSdp(client)
  }

  send(data: T) {
    if (!this.ready.triggered)
      throw Error('Unable to send data before connection is ready')
    this.rtc.send(data)
  }

  private async bindRtcStatus() {
    try {
      for await (const state of this.rtc.statusChange)
        switch (state) {
          case State.CONNECTED:
            this.ready.activate()
            break

          case State.OFFLINE:
            this.ready.deactivate(Error('RTC Connection closed before fully ready'))
            break
        }
    } catch (err) {
      this.ready.deactivate(err)
    }
  }

  private async exchangeSdp(client: Client) {
    // Openers should create offer -> accept answer
    try {
      if (await client.isOpener.event) {
        client.creator.activate(await this.rtc.createOffer())
        this.rtc.acceptSDP(await client.acceptor.event)
      } else { // Closers should accept offter -> create answer
        this.rtc.acceptSDP(await client.acceptor.event)
        client.creator.activate(await this.rtc.createAnswer())
      }
    } catch (err) {
      this.ready.deactivate(err)
    }
  }
}
