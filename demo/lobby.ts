import { LitElement, html, customElement, property, internalProperty } from 'lit-element'
import { Listener } from 'fancy-emitter'
import type { SimpleClient } from '../index.js'

@customElement('lit-lobby')
export default class extends LitElement {
  /** Activated when a client joins the lobby */
  @property({ attribute: false })
  connection!: Listener<SimpleClient>

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

  protected async firstUpdated() {
    for await (const client of this.connection) {
      this.dispatchEvent(new CustomEvent('log', { detail: `${client.name} has joined the lobby` }))
      this.clients = [...this.clients, { client, ack: false }]

      this.bindProposals(client)
      this.bindDisconnection(client)
    }
  }

  private async bindDisconnection(client: SimpleClient) {
    await client.disconnect.event
    this.dispatchEvent(new CustomEvent('log', { detail: `${client.name} has left the lobby` }))
    this.clients = this.clients.filter(({ client: currentClient }) => currentClient != client)
  }

  private async bindProposals(client: SimpleClient) {
    for await (const { members, ack, action } of client.initiator) { // TODO also support own proposals
      const names = members.map(({ name }) => name).join(', ')
      this.dispatchEvent(new CustomEvent('log', { detail: `${client ? client.name : ''} proposed a group for ${names} & you` }))
      this.bindAck(names, ack, action)
    }
  }

  private async bindAck(groupName: string, ack: Listener<SimpleClient>, action?: (accept: boolean) => void) {
    const current = action
      ? this.proposals.length // the index of the proposal we may add
      : undefined

    if (action) // proposal that we can accept or reject
      this.proposals = [...this.proposals, { groupName, action }]

    try {
      for await (const { name } of ack)
        this.dispatchEvent(new CustomEvent('log', { detail: `${name} accepted invitation with ${groupName} & you` }))
    } catch (err) {
      this.dispatchEvent(new CustomEvent('log', {
        detail: [
          err.client
            ? `${err.client.name} rejected invitation to group with ${groupName} & you`
            : `Group with ${groupName} & you was shut down`,
          err
        ]
      }))
    } finally { // Remove the proposal once it is completed.
      if (typeof current == 'number')
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