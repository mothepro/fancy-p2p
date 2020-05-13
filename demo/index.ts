import { LitElement, html, customElement, property } from 'lit-element'
import type Client from '../src/Client.js'
import Peer from '../index.js'
import './log.js'

@customElement('lit-peer')
export default class extends LitElement {
  @property({ type: Number })
  private port!: number

  @property({ type: String })
  private name!: string

  @property({ attribute: false, type: Object })
  private clients: { [key: number]: { name: string, ack: boolean } } = {}

  @property({ attribute: false, type: String })
  private log: any = 'Initiated with State as 0'

  private peer!: Peer

  firstUpdated() {
    this.peer = new Peer(signaling, stuns, 0, this.name)

    this.peer.stateChange
      .on(state => this.log = `State changed to ${state}`)
      .catch(err => this.log = err)

    this.peer.join.on(({ id, name }) => this.clients = { ...this.clients, [id]: { name, ack: false } })
    this.peer.leave.on(id => delete this.clients[id] && this.requestUpdate()) // no es6 way to delete

    this.peer.propose.on(({ members, action, ack }) => {
      this.log = `proposal ${members}`

      ack
        .on(member => this.log = `${member} has joined you & ${members}`)
        .catch(e => this.log = [`Group with ${members} is closed`, e])

      if (action)
        action(confirm(`Accept group with ${members}`))
    })


    this.peer.stateChange.on(state => {
      if (state == State.READY) {
        this.log = `our number ${this.peer.random(true)}`
        for (const [, { name, message }] of this.peer.peers)
          message
            .on(data => this.log = `${name} says ${data}`)
            .catch(e => this.log = [`Connection with ${name} closed`, e])
      }
    })
  }

  private propose = (event: Event) => {
    event.preventDefault()
    const members = Object.entries(this.clients)
      .filter(([, { ack }]) => ack)
      .map(([id]) => parseInt(id))
    this.peer.proposeGroup(...members)
  }

  render = () => html`
  <form @submit=${this.propose}>
    ${!!Object.keys(this.clients).length
      ? html`
    <ul id="others">
      ${Object.entries(this.clients).map(([id, { name, ack }]) => html`
        <li>
          <input
            type="checkbox"
            name=${id}
            .checked=${ack} 
            @click=${() => this.clients = { ...this.clients, [id]: { name, ack: !ack } }}
          />
          ${name}
        </li>`)}
    </ul>`
      : 'Waiting for others to connect'}
    <br/>
    <input
      type="submit"
      value="Make Group"
      ?disabled=${!Object.values(this.clients).filter(({ ack }) => ack).length}
    />
  </form>
  <br/>

  <lit-log .entry=${this.log}></lit-log>
  `
}
