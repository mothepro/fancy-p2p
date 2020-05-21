import { LitElement, html, customElement, property, internalProperty } from 'lit-element'
import type { LogEntry } from './log.js'
import type { SimplePeer } from '../index.js'
import P2P from '../src/P2P.js'
import { Sendable } from '@mothepro/ez-rtc'

const enum Message {
  RTT,
  GENERATE_RANDOM,
}

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

  /** Function to generate consistent random number. */
  @property({ attribute: false })
  random!: P2P['random']

  /** List of peers we are connected to. */
  @property({ attribute: false })
  peers!: SimplePeer[]

  /** The number of microseconds when requesting an RTT. */
  private initRtt?: number

  private replies = 0

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

  private async bindMessage({ message, send, name }: SimplePeer) {
    try {
      for await (const data of message) {
        if (data instanceof ArrayBuffer) {
          if (data.byteLength != 1)
            throw Error(`${name} sent an ArrayBuffer(${data.byteLength}), only expecting buffers of size 1`)

          switch (new DataView(data).getInt8(0)) {
            case Message.GENERATE_RANDOM:
              this.log(`${name} shared the random number ${this.random(true)} for us`)
              break

            case Message.RTT:
              if (this.initRtt) {
                this.log(`Round Trip Time with ${name} is ${this.elapsedTime - this.initRtt}μs`)
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
              throw Error(`${name} sent unexpected byte ${data}`)
          }
        } else
          this.log(`${name} says "${data}"`)
      }
    } catch (err) {
      this.log(err)
    }
    this.log(`Connection with ${name} closed`)
  }

  protected readonly render = () => html`
      Peers
      <ul>
      ${[...this.peers].map(({ name }) => html`
        <li>${name}</li>`)}
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
      <button @click=${this.sendRandom}>Generate Random Number</button>`

  private sendData = (event: Event) => {
    event.preventDefault()
    this.dispatchEvent(new CustomEvent('broadcast', { detail: this.data, bubbles: true }))
    this.log(`Broadcasted "${this.data}"`)
    this.data = ''
  }

  private sendRandom = (event: Event) => {
    event.preventDefault()
    this.dispatchEvent(new CustomEvent('broadcast', { detail: new Uint8Array([Message.GENERATE_RANDOM]), bubbles: true }))
    this.log(`A shared random number for us is ${this.random(true)}`)
  }

  private sendRtt = (event: Event) => {
    event.preventDefault()
    this.initRtt = this.elapsedTime
    this.dispatchEvent(new CustomEvent('broadcast', { detail: new Uint8Array([Message.RTT]), bubbles: true }))
  }
}
