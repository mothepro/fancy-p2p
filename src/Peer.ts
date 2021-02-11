import { Emitter, Listener } from 'fancy-emitter'
import type { ClientID, Name } from '@mothepro/signaling-lobby'
// TODO use ez-rtc instead
import type SimplePeer from 'simple-peer'
import Client from './Client.js'
import Signaling from './Signaling.js'

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
  readonly ready = Promise.resolve(true)
  constructor(readonly name: Name) { }
}

export default class <T extends Sendable = Sendable> implements MySimplePeer<T> {
  private rtc?: SimplePeer.Instance
  readonly isYou = false
  readonly name: Name
  readonly message: Emitter<Exclude<T, ArrayBufferView>> = new Emitter
  readonly ready: Promise<boolean>
  readonly fallbackId: ClientID

  readonly send = (data: T)  => {
    if (this.rtc)
      this.rtc.send(data as any) // this is fine since browser handles casting
    else if (this.fallback) {
      let val: ArrayBuffer
      if (data instanceof ArrayBuffer)
        val = data
      else if (ArrayBuffer.isView(data))
        val = data.buffer
      // TODO transform strings into buffers
      else
        throw Error('Only buffers can be used when sending data thru fallback server')
      this.fallback.sendFallback(this.fallbackId, val)
    } else
      throw Error('Unable to send data to peer directly nor thru server')
  }

  // TODO closing all peers should close the fallback as well
  readonly close = () => {
    if (this.rtc)
      this.rtc.destroy()
    this.message.cancel()
  }

  constructor(stuns: string[], client: Client, retries = 1, timeout = -1, readonly fallback?: Signaling) {
    this.name = client.name
    this.fallbackId = client.id
    this.ready = this.makeRtc(stuns, client, retries, timeout)
      .then(() => { // Bind events to the message emitter
        this.rtc!.once('close', this.message.cancel)
        this.rtc!.once('error', this.message.deactivate)
        this.rtc!.on('data', data => this.message.activate(ArrayBuffer.isView(data) ? data.buffer : data))
        return true
      }).catch((reason: Error) => {
        delete this.rtc
        // Switch to fallback if the direct connection still isn't made
        if (this.fallback) {
          this.fallback.fallbackMessage
            // @ts-ignore support all T in fallback messages
            .on(({ from, data }) => from == this.fallbackId && this.message.activate(data))
            .then(this.close)
          return false
        } else {
          // Cancel early since no events will ever occur.
          this.message.cancel()
          throw reason
        }
      })
  }

  private makeRtc(stuns: string[], client: Client, retries: number, timeout: number): Promise<unknown> {
    if (retries < 0)
      throw Error('Not attempting to create a p2p connection')
    
    // @ts-ignore from the `import 'simple-peer'`
    this.rtc = new SimplePeer({
      initiator: client.isOpener,
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
    // If using trickle, listen to more than just 1 event from each
    this.rtc.once('signal', client.creator.activate)
    client.acceptor.next.then(sdp => this.rtc!.signal(sdp))

    return new Promise((resolve, reject) => {
      if (timeout > 0)
        setTimeout(() => reject(Error(`Connection with "${this.name}" didn't become ready in ${timeout}ms`)), timeout)
      this.rtc!
        .once('connect', resolve)
        .once('error', reject)
    }).catch(reason => retries > 0
      ? this.makeRtc(stuns, client, retries - 1, timeout)
      : Promise.reject(reason))
  }
}
