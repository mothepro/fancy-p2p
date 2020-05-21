import { LitElement, html, customElement, property } from 'lit-element'
import type { Sendable } from '@mothepro/ez-rtc'
import type { LogEntry } from './log.js'
import P2P, { State, SimpleClient } from '../index.js'
import config from './server-config.js'
import './lobby.js'
import './log.js'
import './direct.js'

type ProposeGroupEvent = CustomEvent<SimpleClient[]>
type BroadcastEvent = CustomEvent<Sendable>

declare global {
  interface HTMLElementEventMap {
    broadcast: BroadcastEvent
    proposal: ProposeGroupEvent
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

  private p2p?: P2P

  private readonly log = (...detail: LogEntry) =>
    this.dispatchEvent(new CustomEvent('log', { detail, bubbles: true }))
    && this.requestUpdate()

  protected async firstUpdated() {
    this.p2p = new P2P(config.signaling, config.stuns, 0, this.name, this.retries, this.timeout)
    try {
      for await (const state of this.p2p.stateChange)
        this.log(`State changed to ${state}`)
    }
    catch (err) {
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
              .connection=${this.p2p.connection}
              @proposeGroup=${this.proposeGroup}
            ></lit-lobby>`

        case State.LOADING:
          return 'Loading...'

        case State.READY:
          return html`
            <lit-direct
              .peers=${[...this.p2p.peers]}
              .random=${this.p2p.random}
              @broadcast=${this.broadcast}
            ></lit-direct>`
      }

    return 'Offline'
  }
}
