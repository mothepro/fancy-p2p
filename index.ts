import { LitElement, html, customElement, property } from 'lit-element'
import type { SimpleClient } from '../src/Client.js'
import { signaling, stuns } from './dev-server-config.json'
import ClientError from '../util/ClientError.js'
import P2P from '../index.js'
import './log.js'

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

  firstUpdated() {
    this.p2p = new P2P(signaling, stuns, 0, this.name)

    this.p2p.stateChange
      .on(state => this.log = `State changed to ${state}`)
      .catch(err => this.log = ['status deactivated', err])
      .finally(() => this.log = 'State will no longer be updated')

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
        action(confirm(`Accept group with ${names}`))
    }
  }

  private async bindReady() {
    for (const { name, message } of await this.p2p.ready.event)
      message
        .on(data => data instanceof ArrayBuffer && data.byteLength == 1
          ? this.log = `A shared random number for us is ${this.p2p.random(true)}`
          : this.log = `${name} says "${data}"`)
        .catch(err => this.log = [`Connection with ${name} closed`, err])
  }

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
      this.log = `A shared random number for us is ${this.p2p.random(true)}`
      this.p2p.broadcast(new ArrayBuffer(1))
    } catch (err) {
      this.log = err
    }
  }

  render = () => html`${
    this.p2p && this.p2p.ready.triggered
      ? html`
      <form @submit=${this.broadcast}>
        <input required type="text" name="data" autocomplete="off" value=${this.data} @change=${({target}: ChangeEvent) => this.data = target!.value}/>
        <input type="submit" value="Broadcast">
      </form>
      <button @click=${this.genRandom}>Generate Random Number</button>
      `
      : html`
      <form @submit=${this.propose}>${ // This shouldn't be displayed if in LOADING state
        !!this.clients.length
          ? html`
          Clients connected to this lobby
          <ul id="others">${
            [...this.clients].map(({ name }, index) => html`
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
          </ul>`
          : 'Waiting for others to connect'}
      <br/>
      <input
        type="submit"
        value="Make Group"
        ?disabled=${!this.acks.some(ack => ack)}
      />
      </form>`}

  <lit-log .entry=${this.log}></lit-log>`
}
