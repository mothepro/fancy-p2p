import { LitElement, html, customElement, property, internalProperty } from 'lit-element'
import type { LogEntry } from 'lit-log'
import P2P, { State, Client, Sendable } from '../index.js'

import './lobby.js'
import './direct.js'

type ProposeGroupEvent = CustomEvent<Client[]>
type BroadcastEvent = CustomEvent<Sendable>

declare global {
  interface HTMLElementEventMap {
    broadcast: BroadcastEvent
    proposal: ProposeGroupEvent
    requestRNG: CustomEvent<void>
  }
}

@customElement('lit-peer')
export default class extends LitElement {
  @property({ type: String })
  private name!: string

  @property({ type: Array })
  private stuns!: string[]

  @property({ type: String })
  private server!: string

  @property({ type: String })
  private lobby!: string

  @property({ type: String })
  private version!: string

  @property({ type: Number })
  private retries?: number

  @property({ type: Number })
  private timeout?: number

  @property({ type: Boolean })
  private fallback?: boolean

  @internalProperty()
  private random = 0

  private p2p?: P2P

  private readonly log = (...detail: LogEntry) =>
    this.dispatchEvent(new CustomEvent('log', { detail, bubbles: true }))
    && this.requestUpdate()

  protected async firstUpdated() {
    const { stuns, name, lobby, server: address, version, retries, timeout, fallback } = this
    this.p2p = new P2P(name, { stuns, lobby, retries, timeout, fallback, server: { address, version } })

    try {
      for await (const state of this.p2p.stateChange) {
        this.log(`State changed to ${state}`)
        if (state == State.READY)
          this.random = this.p2p.random(true)
      }
    } catch (err) {
      this.log('State deactivated', err)
    }
    this.log('State will no longer be updated')
  }

  private readonly proposeGroup = ({ detail }: ProposeGroupEvent) => {
    try {
      this.p2p!.proposeGroup(...detail)
    } catch (err) {
      this.log('Proposal failed', err)
    }
  }

  private readonly broadcast = ({ detail }: BroadcastEvent) => {
    try {
      this.p2p!.broadcast(detail)
    } catch (err) {
      this.log('Broadcast failed', err)
    }
  }

  protected readonly render = () => {
    if (this.p2p?.stateChange.isAlive)
      switch (this.p2p!.state) {
        case State.LOBBY:
          return html`
            <lit-lobby
              .connection=${this.p2p.lobbyConnection}
              @proposeGroup=${this.proposeGroup}
            ></lit-lobby>`

        case State.LOADING:
          return 'Loading...'

        case State.READY:
          return html`
            <lit-direct
              .peers=${this.p2p.peers}
              next-random=${this.random}
              @broadcast=${this.broadcast}
              @requestRNG=${() => this.random = this.p2p!.random(true)}
            ></lit-direct>`
      }

    return 'Offline'
  }
}
