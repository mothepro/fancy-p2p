import { LitElement, html, customElement, property } from 'lit-element'
import Wow from '../index.js'
import './log.js'

const params = new URLSearchParams(location.search)

@customElement('lit-socket')
export default class extends LitElement {
  @property({ attribute: false, type: Object })
  private clients: { [key: number]: { name: string, ack: boolean } } = {}

  @property({ attribute: false, type: String })
  private log: any = 'Ready'

  private readonly wow = new Wow(
    `ws://localhost:${parseInt(params.get('port')!)}`,
    ['stun:stun.l.google.com:19302'],

    parseInt(params.get('lobby')!),
    params.get('name')!)

  firstUpdated() {
    this.wow.stateChange
      .on(state => this.log = `state changed ${state}`)
      .catch(err => this.log = err)

    this.wow.join.on(({ id, name }) => this.clients = { ...this.clients, [id]: { name, ack: false } })
    this.wow.leave.on(id => delete this.clients[id] && this.requestUpdate()) // no es6 way to delete

    this.wow.propose.on(({ members, action, ack }) => this.log = `proposal ${members}`)
  }

  private propose = (event: Event) => {
    event.preventDefault()
    const members = Object.entries(this.clients)
      .filter(([, { ack }]) => ack)
      .map(([id]) => parseInt(id))
    this.wow.proposeGroup(...members)
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
