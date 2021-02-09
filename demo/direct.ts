import { LitElement, html, customElement, property, internalProperty } from 'lit-element'
import type { LogEntry } from 'lit-log'
import type { Peer } from '../index.js'

import 'lit-log'

const enum Message {
  CHECK,
  RTT,
  GENERATE_RANDOM,
}

const decoder = new TextDecoder,
  encoder = new TextEncoder,
  orderTestLimit = 5e3

declare global {
  interface KeyboardEvent {
    target: EventTarget & {
      value: string
    }
  }
}

@customElement('lit-direct')
export default class extends LitElement {
  @internalProperty()
  private data = ''

  @internalProperty()
  private chat?: LogEntry

  /** Number generated by shared RNG. */
  @property({ type: Number, attribute: 'next-random' })
  nextRandom!: number

  /** List of peers we are connected to. */
  @property({ attribute: false })
  peers!: Peer[]

  /** The number of microseconds when requesting an RTT. */
  private initRtt?: number

  private replies = 0

  private orderedMessages: number[] = []

  /**
   * Number of microseconds have passed since the page has opened.
   * Could be innaccurate due to https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#Reduced_time_precision
   */
  get elapsedTime() {
    return Math.trunc(1000 * performance.now())
  }

  private readonly log = (...detail: LogEntry) =>
    this.dispatchEvent(new CustomEvent('log', { detail, bubbles: true, composed: true }))
    && this.requestUpdate()

  protected firstUpdated() {
    for (const peer of this.peers)
      this.bindMessage(peer)
  }

  private async bindMessage({ message, send, name }: Peer) {
    try {
      for await (const data of message) {
        if (!(data instanceof ArrayBuffer))
          throw Error(`${name} sent unexpected data: ${data}`)

        const view = new DataView(data)
        switch (view.getInt8(0)) {
          case Message.CHECK:
            this.orderedMessages.push(view.getUint32(1, true))
            if (this.orderedMessages.length == orderTestLimit) {
              for (let i = 0; i < this.orderedMessages.length - 1; i++) {
                if (this.orderedMessages[i] > this.orderedMessages[i + 1])
                  this.log(this.orderedMessages[i], 'should have come before', this.orderedMessages[i + 1])
              }
              this.chat = `Finished checking order of ${orderTestLimit} messages`
              this.orderedMessages.length = 0
            }
            break

          case Message.GENERATE_RANDOM:
            this.chat = `${name} shared the random integer ${this.nextRandom} for us`
            this.dispatchEvent(new CustomEvent('requestRNG', { bubbles: true }))
            break

          case Message.RTT:
            if (this.initRtt) {
              this.chat = `Round Trip Time with ${name} is ${this.elapsedTime - this.initRtt}μs`
              this.replies++
            } else
              send(new Uint8Array([Message.RTT]))

            // All living peers responded
            if (this.replies == this.peers.length) {
              delete this.initRtt
              this.replies = 0
            }
            break

          default:
            this.chat = `${name} says "${decoder.decode(data)}"`
        }
      }
    } catch (err) {
      this.log(err)
    }
    this.log(`Connection with ${name} closed`)
  }

  protected readonly render = () => html`
    <lit-log open id="log" .entry=${this.chat}>
      <span slot="summary">Chat</span>

      Peers
      <ul>
      ${[...this.peers].map(peer => html`
        <li @click=${this.sendDirect(peer)}>
          ${peer.name}
          ${peer.isYou ? '🌟' : ''}
        </li>`)}
      </ul>
      <form @submit=${this.sendData}>
        <input
          required
          type="text"
          name="data"
          autocomplete="off"
          placeholder="Message"
          .value=${this.data}
          @change=${({ target: { value } }: KeyboardEvent) => this.data = value}
        />
        <input type="submit" value="Broadcast">
      </form>
      <button @click=${this.sendRtt}>Latency Check</button>
      <button @click=${this.sendRandom}>Generate Random Number</button>
      <button
        @click=${this.orderTest} 
        title=${`Sends ${orderTestLimit} packets and peers are expected to receive them all in order.`}
      >Order check</button>
    </lit-log>`

  private sendData = (event: Event) => {
    event.preventDefault()
    this.dispatchEvent(new CustomEvent('broadcast', { detail: encoder.encode(this.data), bubbles: true }))
    this.data = ''
  }

  private sendDirect = ({ name, send }: Peer) => (event: Event) => {
    try {
      event.preventDefault()
      send(encoder.encode(this.data))
      this.log(`Sending ${name} "${this.data}"`)
      this.data = ''
    } catch (err) {
      this.log(err)
    }
  }

  private sendRandom = (event: Event) => {
    event.preventDefault()
    this.dispatchEvent(new CustomEvent('broadcast', { detail: new Uint8Array([Message.GENERATE_RANDOM]), bubbles: true }))
  }

  private sendRtt = (event: Event) => {
    event.preventDefault()
    this.initRtt = this.elapsedTime
    this.dispatchEvent(new CustomEvent('broadcast', { detail: new Uint8Array([Message.RTT]), bubbles: true }))
  }

  private orderTest = (event: Event) => {
    event.preventDefault()
    const detail = new DataView(new ArrayBuffer(1 + 4))
    detail.setInt8(0, Message.CHECK)
    for (let i = 0; i < orderTestLimit; i++) {
      detail.setUint32(1, i, true)
      this.dispatchEvent(new CustomEvent('broadcast', { detail, bubbles: true }))
    }
  }
}
