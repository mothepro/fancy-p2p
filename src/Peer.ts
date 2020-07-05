import { Emitter, Listener } from 'fancy-emitter'
import type { Name } from '@mothepro/signaling-lobby'
import type SimplePeer from 'simple-peer'
import Client from './Client.js'

type Receiveable = Blob | ArrayBuffer
export type Sendable = Receiveable | ArrayBufferView

/** Represents a direct connection to a peer found in the signalling lobby. */
export interface MySimplePeer<T = Sendable> {
  /** Name of the new peer. */
  readonly name: Name
  /** Send data to activate the `message` listener for the peer. */
  send(data: T): void
  /** Activates when a message is received for this peer. Cancels once the connection is closed. */
  readonly message: Listener<Exclude<T, ArrayBufferView>>
  /**
   * Whether this peer represents a "connection" to you.
   * When false this is another peer and data is sent through the wire.
   */
  readonly isYou: boolean
  /** Close the connection with this peer. */
  close(): void
}

/** Simple class that can be used as a local feedback peer. */
export class MockPeer<T extends Sendable = Sendable> implements MySimplePeer<T> {
  readonly isYou = true
  readonly message: Emitter<Exclude<T, ArrayBufferView>> = new Emitter
  // Convert ArrayBufferView's to their raw buffer to match how it is over the wire.
  readonly send = (data: T) => this.message.activate(
    // @ts-ignore Type 'ArrayBuffer' **is** assignable to type 'Exclude<T, ArrayBufferView>' since T mustin include Buffers and their views together
    ArrayBuffer.isView(data)
      ? data.buffer
      : data)
  readonly close = this.message.cancel
  constructor(readonly name: Name) { }
}

export default class <T extends Sendable = Sendable> implements MySimplePeer<T> {
  private rtc!: SimplePeer.Instance
  readonly isYou = false
  readonly name: Name
  readonly message: Emitter<Exclude<T, ArrayBufferView>> = new Emitter
  // @ts-ignore stupid...
  readonly send = (data: T) => this.rtc.send(data)
  readonly close = () => this.rtc.destroy()
  readonly ready: Promise<void>

  constructor(stuns: string[], client: Client, retries = 1, timeout = -1) {
    this.name = client.name
    this.ready = this.makeRtc(stuns, client, retries, timeout)
      .then(() => { // Bind events to the message emitter
        this.rtc.once('close', this.message.cancel)
        this.rtc.once('error', this.message.deactivate)
        this.rtc.on('data', data => this.message.activate(ArrayBuffer.isView(data) ? data.buffer : data))
      })
      // Cancel early since no events will ever occur.
      .catch((reason: Error) => this.message.cancel() && Promise.reject(reason))
  }

  private async makeRtc(stuns: string[], client: Client, retries: number, timeout: number): Promise<unknown> {
    // @ts-ignore from the `import 'simple-peer'`
    this.rtc = new SimplePeer({
      initiator: await client.isOpener.event,
      config: { iceServers: [{ urls: stuns }] },
      trickle: false, // TODO the server should support this eventually... may even work now!
      offerConstraints: {
        iceRestart: true, // Forces refresh of candidates
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
        voiceActivityDetection: false,
      },
      answerConstraints: {
        iceRestart: true, // Forces refresh of candidates
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
        voiceActivityDetection: false,
      },
    })
    
    // Exchange the SDPs
    this.rtc
      .once('signal', client.creator.activate) // Change to `.on` if using trickle
      .signal(await client.acceptor.next)

    return new Promise((resolve, reject) => {
      setTimeout(() => reject(Error(`Connection didn't become ready in ${timeout}ms`)), timeout)
      this.rtc
        .once('connect', resolve)
        .once('error', reject)
    }).catch(reason => retries > 0
      ? this.makeRtc(stuns, client, retries - 1, timeout)
      : Promise.reject(reason))
  }
}
