import { SafeSingleEmitter, SafeEmitter, Emitter } from 'fancy-emitter'
import { ClientID, Code, Name, LobbyID, Max } from '@mothepro/signaling-lobby'
import { buildProposal, buildIntro } from '../util/builders.js'
import { parseGroupFinalize, parseGroupChange, parseClientLeave, parseClientJoin, parseSdp } from '../util/parsers.js'

/**
 * Handle the communication with the signaling server.
 * 
 * Joins the lobby on server upon construction.
 * Allows for creation, approval and rejection of groups.
 */
export default class {

  private readonly socket: WebSocket

  /** Names belonging to all clients connected. */
  // TODO replace with a simple array after grouping.
  private readonly names: Map<ClientID, Name> = new Map

  private readonly groups: Map<string, Emitter<ClientID>> = new Map

  /** Received some Data from the Server */
  private readonly message = new Emitter<DataView>(data => {
    if (this.groupFinal.triggered)
      parseSdp(data)
    else
      switch (data.getUint8(0)) {
        case Code.CLIENT_JOIN:
          this.clientJoin.activate(parseClientJoin(data))
          break

        case Code.CLIENT_LEAVE:
          this.clientLeave.activate(parseClientLeave(data))
          break

        case Code.GROUP_REJECT:
        case Code.GROUP_REQUEST:
          const { approve, actor, members } = parseGroupChange(data),
            hash = members.sort().toString()
          
          if (approve) {
            // Initiate the group if it hasn't been propopsed before
            if (!this.groups.has(hash)) {
              this.groups.set(hash, new Emitter)
              this.groupInitiate.activate({
                members,
                ack: this.groups.get(hash)!,
                action: (accept) => this.socket.send(buildProposal(accept, ...members))
              })
            }

            this.groups.get(hash)!.activate(actor)
          } else {
            this.groups.get(hash)?.cancel()
            this.groups.delete(hash)
          }
          break

        case Code.GROUP_FINAL:
          const { code, members: ids, cmp } = parseGroupFinalize(data)
          this.groupFinal.activate({
            code,
            members: ids.map(id => ({
              id,
              shouldOffer: cmp < id, // use the `cmp` to determine who should send the offers
            })),
          })
          return
      }
  })

  /** Activated when a client join message is received. */
  readonly clientJoin = new SafeEmitter<{
    id: ClientID
    name: Name
  }>(({ id, name }) => this.names.set(id, name))

  /** Activated when a client leave message is received. */
  readonly clientLeave = new SafeEmitter<ClientID>(id => this.names.delete(id))

  /** Activated when a group proposal/ack message is received. */
  readonly groupInitiate = new SafeEmitter<{
    /** The members in this group */
    members: ClientID[]
    /** Function to accept or reject the group */
    action(accept: boolean): void
    /** The id of client just accepted the group. Cancelled when someone rejects. */
    ack: Emitter<ClientID>
  }>()

  /** Activated when a group finalization message is received. */
  // TODO cancel all other emitters?
  readonly groupFinal = new SafeSingleEmitter<{
    code: number
    members: {
      id: ClientID
      shouldOffer: boolean // just have emitter to give values
    }[]
  }>()

  constructor(address: string, lobby: LobbyID, name: Name) {
    this.socket = new WebSocket(address)
    this.socket.addEventListener('open', () => this.socket.send(buildIntro(lobby, name)))
    this.socket.addEventListener('close', this.message.cancel)
    this.socket.addEventListener('error', ev => this.message.deactivate(Error(`Connection to Server closed unexpectedly. ${ev}`)))
    this.socket.addEventListener('message', async ({ data }) => data instanceof Blob
      && this.message.activate(new DataView(await data.arrayBuffer())))
  }

  // should activate group initiate?
  proposeGroup = (...ids: ClientID[]) => this.socket.send(buildProposal(true, ...ids))

  close = () => this.socket.close()
}
