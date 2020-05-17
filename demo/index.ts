import { LitElement, html, customElement, property } from 'lit-element'
import { filter } from 'fancy-emitter'
import type { SimpleClient } from '../src/Client.js'
import type { SimplePeer } from '../src/Peer.js'
import config from './server-config.js'
import ClientError from '../util/ClientError.js'
import P2P, { State } from '../index.js'
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

@customElement('lit-peer')
export default class extends LitElement {
  @property({ type: String })
  private name!: string

  @property({ type: Number })
  private retries?: number

  @property({ type: Number })
  private timeout?: number

  /** Others connected to the lobby. */
  @property({ attribute: false, type: Array })
  private clients: SimpleClient[] = []

  /** Clients that we would like to include in our group */
  @property({ attribute: false, type: Array })
  private acks: boolean[] = []

  @property({ attribute: false, type: String })
  private log: any = 'Initiated with State 0'

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
        // clear what we know...
        this.clients = []
        this.acks = []
      })

    this.bindClient()
    this.bindReady()
    this.bindProposals()
  }

  private async bindClient() {
    for await (const client of this.p2p.connection) {
      this.log = `${client.name} has joined the lobby`
      this.clients = [...this.clients, client]
      this.acks = [...this.acks, false]

      client.disconnect.once(() => {
        this.log = `${client.name} has left the lobby`
        this.acks = this.acks.filter((_, i) => i != this.clients.indexOf(client))
        this.clients = this.clients.filter(curr => curr != client)
      })
    }
  }

  private async bindProposals() {
    for await (const { members, ack, action, client } of this.p2p.initiator) {
      const names = members.map(({ name }) => name).join(', ') + ' & you'
      this.log = `${client ? client.name : 'I'} proposed a group for ${names}`

      ack
        .on(({ name }) => this.log = `${name} accepted invitation for ${names}`)
        .catch((err: ClientError) => this.log = [`${err.client ? err.client.name : 'I'} rejected invitation for ${names}`, err])

      if (action)
        action(true) //confirm(`Accept group with ${names}`))
    }
  }

  private async bindReady() {
    await filter(this.p2p.stateChange, State.READY)
    for (const peer of this.p2p.peers)
      this.bindMessage(peer)
    this.clients = []
    this.acks = []
  }

  private async bindMessage({ name, message, send }: SimplePeer) {
    try {
      for await (const data of message) {
        if (data instanceof ArrayBuffer) {
          if (data.byteLength != 1)
            throw Error(`${name} sent an ArrayBuffer(${data.byteLength}), only expecting buffers of size 1`)

          switch (new DataView(data).getInt8(0)) {
            case Message.GENERATE_RANDOM:
              this.log = `A shared random number for us is ${this.p2p.random(true)}`
              break

            case Message.RTT:
              if (this.initRtt) {
                this.log = `Round Trip Time with ${name} is ${this.elapsedTime - this.initRtt}μs`
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
          this.log = `${name} says "${data}"`
      }
    } catch (err) {
      this.log = [`Connection with ${name} closed`, err]
    }
  }

  render = () => html`${{ // "switch" statement in string
    [State.OFFLINE]: 'P2P is offline',
    [State.LOADING]: 'Loading...',
    [State.LOBBY]: this.renderLobby(),
    [State.READY]: this.renderReady(),
  }[this.p2p?.state || State.OFFLINE]}
  <lit-log .entry=${this.log}></lit-log>`

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
        value=${this.data}
        @change=${({ target }: ChangeEvent) => this.data = target!.value}
      />
      <input type="submit" value="Broadcast">
    </form>
    <button @click=${this.calcRtts}>Latency Check</button>
    <button @click=${this.genRandom}>Generate Random Number</button>`

  /** Chilling in the lobby. */
  private renderLobby = () => !!this.clients.length
    ? html`
    Clients connected to this lobby
    <form @submit=${this.propose}>
      <ul id="others">
        ${[...this.clients].map(({ name }, index) => html`
        <li>
          <label>
            <input
              type="checkbox"
              ?checked=${this.acks[index]}
              @click=${() => this.acks = this.acks.map((ack, i) => index == i ? !ack : ack)}
            />
            ${name}     
          </label>
        </li>`)}
      </ul>
      <input
        type="submit"
        value="Make Group"
        ?disabled=${!this.acks.some(ack => ack)}
      />
    </form>`
    : 'No one else has joined this lobby... yet.'

  // The following methods seem redundant...

  private propose = (event: Event) => {
    event.preventDefault()
    try {
      this.p2p.proposeGroup(...this.clients.filter((_, index) => this.acks[index]))
    } catch (err) {
      this.log = err
    }
  }

  private broadcast = (event: Event) => {
    event.preventDefault()
    try {
      this.p2p.broadcast(this.data)
      this.data = ''
    } catch (err) {
      this.log = err
    }
  }

  private genRandom = (event: Event) => {
    event.preventDefault()
    try {
      this.p2p.broadcast(new Uint8Array([Message.GENERATE_RANDOM]))
      this.log = `A shared random number for us is ${this.p2p.random(true)}`
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
