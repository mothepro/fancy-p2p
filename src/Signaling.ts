import { SafeSingleEmitter, SingleEmitter, SafeEmitter, Emitter } from 'fancy-emitter'
import Connection from '@mothepro/ez-rtc'
import { ClientID, Size, Code, Name, LobbyID, Max } from '@mothepro/signaling-lobby'
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

  private readonly groups: Set<string> = new Set

  // Send intro when ready
  private readonly serverOpen = new SafeSingleEmitter(() => this.socket.send(buildIntro(this.lobby, this.name)))

  private readonly serverClose = new SingleEmitter

  /** Received some Data from the Server */
  private readonly serverMessage = new SafeEmitter<DataView>(data => {
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
          const { approve, actor, members } = parseGroupChange(data)
          if (approve)
            this.groupJoin.activate({ actor, members })
          else
            this.groupLeave.activate({ actor, members })
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
    actor: ClientID
    members: ClientID[]
    action(accept: boolean): void
    // ack: Emitter<ClientID> // TODO this can be used to replace the `groupJoin` and `groupLeave` emitters
  }>()

  /** Activated when a group proposal/ack message is received. */
  readonly groupJoin = new SafeEmitter<{
    actor: ClientID
    members: ClientID[]
  }>(
    // Initiate the group if it hasn't been propopsed before
    ({ actor, members }) => !this.groups.has(members.sort().toString())
      && this.groupInitiate.activate({ actor, members, action: (accept) => this.socket.send(buildProposal(accept, ...members)) }),
    ({ members }) => this.groups.add(members.sort().toString()))

  /** Activated when a group reject message is received. */
  readonly groupLeave = new SafeEmitter<{
    actor: ClientID
    members: ClientID[]
  }>(({ members }) => this.groups.delete(members.sort().toString()))

  /** Activated when a group finalization message is received. */
  // TODO cancel all other emitters?
  readonly groupFinal = new SafeSingleEmitter<{
    code: number
    members: {
      id: ClientID
      shouldOffer: boolean // just have emitter to give values
    }[]
  }>()

  constructor(
    socket: string,
    private readonly lobby: LobbyID,
    private readonly name: Name
  ) {
    this.socket = new WebSocket(socket)

    this.socket.addEventListener('open', this.serverOpen.activate)
    this.socket.addEventListener('close', this.serverClose.activate)
    this.socket.addEventListener('error', ev => this.serverClose.deactivate(Error(`Connection to Server closed unexpectedly. ${ev}`)))
    this.socket.addEventListener('message', async ({ data }) => data instanceof Blob
      && this.serverMessage.activate(new DataView(await data.arrayBuffer())))
  }

  proposeGroup = (...ids: ClientID[]) => this.socket.send(buildProposal(true, ...ids))

  close = () => this.socket.close()
}
