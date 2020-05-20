import { LitElement, html, customElement, property } from 'lit-element'
import { filterValue, Listener } from 'fancy-emitter'
import P2P, { State, SimpleClient, SimplePeer } from '../index.js'
import config from './server-config.js'
import './lobby.js'
import './log.js'

const enum Message {
  RTT,
  GENERATE_RANDOM,
}

// TODO find the real version of this
interface ChangeEvent extends KeyboardEvent {
  target: KeyboardEvent['target'] & {
    value: string
  }
}
type LogEvent = CustomEvent<any>
type ProposeEvent = CustomEvent<SimpleClient[]>

@customElement('lit-peer')
export default class extends LitElement {
  @property({ type: String })
  private name!: string

  @property({ type: Number })
  private retries?: number

  @property({ type: Number })
  private timeout?: number

  @property({ attribute: false, type: String })
  private log: any = 'Initiated with State 0'

  @property({ attribute: false, type: String })
  private chat: any

  @property({ attribute: false, type: String })
  private data: string = ''

  private p2p!: P2P

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

  firstUpdated() {
    this.p2p = new P2P(config.signaling, config.stuns, 0, this.name, this.retries, this.timeout)

    this.p2p.stateChange
      .on(state => this.log = `State changed to ${state}`)
      .catch(err => this.log = ['status deactivated', err])
      .finally(() => {
        this.log = 'State will no longer be updated'
        
      })

    this.bindReady()
  }

  private async bindReady() {
    await filterValue(this.p2p.stateChange, State.READY)
    for (const peer of this.p2p.peers)
      this.bindMessage(peer)
  }

  private async bindMessage({ name, message, send }: SimplePeer) {
    try {
      for await (const data of message) {
        if (data instanceof ArrayBuffer) {
          if (data.byteLength != 1)
            throw Error(`${name} sent an ArrayBuffer(${data.byteLength}), only expecting buffers of size 1`)

          switch (new DataView(data).getInt8(0)) {
            case Message.GENERATE_RANDOM:
              this.chat = `A shared random number for us is ${this.p2p.random(true)}`
              break

            case Message.RTT:
              if (this.initRtt) {
                this.chat = `Round Trip Time with ${name} is ${this.elapsedTime - this.initRtt}μs`
                this.replies++
              } else
                send(new Uint8Array([Message.RTT]))

              // All living peers responded
              if (this.replies == this.p2p.peers.size) {
                delete this.initRtt
                this.replies = 0
              }
              break
          }
        } else
          this.chat = `${name} says "${data}"`
      }
    } catch (err) {
      console.log('bindmessage')
      this.log = [`Connection with ${name} closed`, err]
    }
  }

  render = () => html`${this.p2p && this.p2p.stateChange.isAlive && { // "switch" statement in string
    [State.OFFLINE]: 'P2P is offline',
    [State.LOBBY]: html`
      <lit-lobby
        .connection=${this.p2p.connection}
        @log=${({detail}: LogEvent) => this.log = detail}
        @proposeGroup=${({detail}: ProposeEvent) => { try { this.p2p.proposeGroup(...detail) } catch (err) { this.log = err }}}
      ></lit-lobby>`,
    [State.LOADING]: 'Loading...',
    [State.READY]: this.renderReady(),
  }[this.p2p!.state]}

  <lit-log
    .entry=${this.log}
    ?open=${this.p2p && !this.p2p!.stateChange.isAlive}
  ></lit-log>`

  /** We have direct connections. */
  private renderReady = () => this.p2p && html`
    Peers
    <ul>
    ${[...this.p2p.peers].map(({ name }) => html`
      <li>${name}</li>`)}
    </ul>
    <form @submit=${this.broadcast}>
      <input
        required
        type="text"
        name="data"
        autocomplete="off"
        placeholder="Message"
        .value=${this.data}
        @change=${({ target }: ChangeEvent) => this.data = target!.value}
      />
      <input type="submit" value="Broadcast">
    </form>
    <button @click=${this.calcRtts}>Latency Check</button>
    <button @click=${this.genRandom}>Generate Random Number</button>
    <lit-log open .entry=${this.chat}>Chat</lit-log>`


  // The following methods seem redundant...

  private broadcast = (event: Event) => {
    event.preventDefault()
    try {
      this.p2p.broadcast(this.data)
      this.chat = `Broadcasted "${this.data}"`
      this.data = ''
    } catch (err) {
      this.log = err
    }
  }

  private genRandom = (event: Event) => {
    event.preventDefault()
    try {
      this.p2p.broadcast(new Uint8Array([Message.GENERATE_RANDOM]))
      this.chat = `A shared random number for us is ${this.p2p.random(true)}`
    } catch (err) {
      this.log = err
    }
  }

  private calcRtts = (event: Event) => {
    event.preventDefault()
    try {
      this.initRtt = this.elapsedTime
      this.p2p.broadcast(new Uint8Array([Message.RTT]))
    } catch (err) {
      this.log = err
    }
  }
}
