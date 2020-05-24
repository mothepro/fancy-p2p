import { LitElement, html, customElement, property, internalProperty } from 'lit-element'
import { Listener } from 'fancy-emitter'
import type P2P from '../src/P2P.js'
import type { SimpleClient } from '../index.js'
import type { LogEntry } from 'lit-log'

@customElement('lit-lobby')
export default class extends LitElement {
  /** Activated when a client joins the lobby */
  @property({ attribute: false })
  connection!: Listener<SimpleClient>

  /** Activated when a client joins the lobby */
  @property({ attribute: false })
  groupProposed!: P2P['initiator']

  /** Others connected to the lobby. */
  @internalProperty()
  private clients: {
    client: SimpleClient
    /** Whether we would like to include in our group, if we propose. */
    ack: boolean
  }[] = []

  /** List of incoming proposals */
  @internalProperty()
  private proposals: {
    groupName: string
    action: (accept: boolean) => void
  }[] = []

  private readonly log = (...detail: LogEntry) =>
    this.dispatchEvent(new CustomEvent('log', { detail, bubbles: true, composed: true }))
    && this.requestUpdate()

  protected async firstUpdated() {
    this.bindProposals()
    for await (const client of this.connection) {
      this.clients = [...this.clients, { client, ack: false }]
      this.log(`${client.name} has joined the lobby`)
      this.bindDisconnection(client)
    }
  }

  private async bindDisconnection(client: SimpleClient) {
    await client.disconnect.event
    this.clients = this.clients.filter(({ client: currentClient }) => currentClient != client)
    this.log(`${client.name} has left the lobby`)
  }

  private async bindProposals() {
    for await (const { members, ack, action, client } of this.groupProposed) {
      const names = members.map(({ name }) => name).join(', ')
      this.log(`${client ? client.name : 'You'} proposed a group for ${names} & you`)
      this.bindAck(names, ack, action)
    }
  }

  private async bindAck(groupName: string, ack: Listener<SimpleClient>, action?: (accept: boolean) => void) {
    const current = this.proposals.length // the index of the proposal we may add

    if (action) // proposal that we can accept or reject
      this.proposals = [...this.proposals, { groupName, action }]

    try {
      for await (const { name } of ack)
        this.log(`${name} accepted invitation with ${groupName} & you`)
    } catch (err) {
      this.log(
        err.client
          ? `${err.client.name} rejected invitation to group with ${groupName} & you`
          : `Group with ${groupName} & you was shut down`,
        err)
    } finally { // Remove the proposal once it is completed.
      if (action)
        this.proposals = this.proposals.filter((_, i) => current != i)
    }
  }

  /** Chilling in the lobby. */
  protected readonly render = () => html`${this.clients.length
    ? html`
    Clients connected to this lobby
    <form
      @submit=${(event: Event) => // Propose group of all the ack'd clients
        this.dispatchEvent(new CustomEvent('proposeGroup', {
          detail: this.clients
            .filter(({ ack }) => ack)
            .map(({ client }) => client)
        })) && event.preventDefault()}}
    >
      <ul id="others">
        ${[...this.clients].map(({ client: { name }, ack }, index) => html`
        <li>
          <label>
            <input
              type="checkbox"
              ?checked=${ack}
              @click=${() => this.clients = this.clients.map(({ client, ack: currentAck }, i) => ({
                client,
                ack: index == i ? !currentAck : currentAck,
              }))}
            />
            ${name}     
          </label>
        </li>`)}
      </ul>
      <input
        type="submit"
        value="Propose Group"
        ?disabled=${!this.clients.some(({ ack }) => ack)}
      />
    </form>

    ${this.proposals.map(({ groupName, action }, index) => html`
      Join group with ${groupName}?
      <button
        @click=${() => {
            this.proposals = this.proposals.filter((_, i) => index != i)
            action(true)
          }}>Accept</button>
      <button
        @click=${() => {
            this.proposals = this.proposals.filter((_, i) => index != i)
            action(false)
          }}>Reject</button>
      <br/>`)}`
    : 'No one else has joined this lobby... yet.'}`
}
