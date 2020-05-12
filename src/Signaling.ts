import { SafeSingleEmitter, SingleEmitter, SafeEmitter, Emitter } from 'fancy-emitter'
import type { ClientID, Name, LobbyID } from '@mothepro/signaling-lobby'
import { Code } from '../util/constants.js'
import { buildProposal, buildIntro, buildSdp } from '../util/builders.js'
import { parseGroupFinalize, parseGroupChange, parseClientLeave, parseClientJoin, parseSdp } from '../util/parsers.js'
import Client from './Client.js'

/**
 * Handle the communication with the signaling server.
 * 
 * Joins the lobby on server upon construction.
 * Allows for creation, approval and rejection of groups.
 * Listening on the `groupFinal` emitter will tell caller which offers/answers to create/accept
 */
export default class {

  private readonly server!: WebSocket

  /** Activated when our connection to signaling server is established. */
  readonly ready = new SafeSingleEmitter(() => this.server.send(buildIntro(this.lobby, this.name)))

  readonly finalized: SafeSingleEmitter<{
    code: number
    members: Client[]
  }> = new SafeSingleEmitter

  /** Activated when a new client joins the lobby. */
  readonly join: SafeEmitter<Client> = new SafeEmitter

  /** Received some Data from the Server */
  private readonly message = new Emitter<DataView>(
    Client.onMessage.activate,
    data => {
    if (!this.finalized.triggered)
      switch (data.getUint8(0)) {
        case Code.CLIENT_JOIN:
          this.join.activate(Client.joined(parseClientJoin(data), this.message))
          return

        case Code.GROUP_FINAL:

          return
      }
  })

  /** When activated connection to server is closed. */
  // TODO cancel all other emitters?
  readonly close = new SingleEmitter(this.message.cancel, () => this.server.close())

  constructor(address: string, private readonly lobby: LobbyID, private readonly name: Name) {
    try {
      this.server = new WebSocket(address)
      this.server.addEventListener('open', this.ready.activate)
      this.server.addEventListener('close', this.close.activate)
      this.server.addEventListener('error', ev => this.close.deactivate(Error(`Connection to Server closed unexpectedly. ${ev}`)))
      this.server.addEventListener('message', async ({ data }) => data instanceof Blob
        && this.message.activate(new DataView(await data.arrayBuffer())))
    } catch (err) {
      this.close.deactivate(err)
    }
  }

  // TODO make DRY with `message` switch case
  proposeGroup = (...members: Client[]) => {
    const hash = members.sort().toString()

    if (this.groups.has(hash))
      throw Error('Can not propose a group that is already formed.')

    const ack = new Emitter<ClientID>()
    this.groupInitiate.activate({ members, ack })
    this.groups.set(hash, ack)
    this.server.send(buildProposal(true, ...members))
  }
}
