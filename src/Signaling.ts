import { SafeSingleEmitter, SafeEmitter, Emitter } from 'fancy-emitter'
import { ClientID, Code, Name, LobbyID } from '@mothepro/signaling-lobby'
import { buildProposal, buildIntro, buildSdp } from '../util/builders.js'
import { parseGroupFinalize, parseGroupChange, parseClientLeave, parseClientJoin, parseSdp } from '../util/parsers.js'

interface Opener {
  createOffer(sdp: RTCSessionDescriptionInit): void
  acceptAnswer: Promise<RTCSessionDescriptionInit>
}

interface Closer {
  acceptOffer: Promise<RTCSessionDescriptionInit>
  createAnswer(sdp: RTCSessionDescriptionInit): void
}

/**
 * Handle the communication with the signaling server.
 * 
 * Joins the lobby on server upon construction.
 * Allows for creation, approval and rejection of groups.
 * Listening on the `groupFinal` emitter will tell caller which offers/answers to create/accept
 */
export default class {

  private readonly server: WebSocket

  /** Names belonging to all clients connected. */
  // TODO replace with a simple array after grouping.
  private readonly names: Map<ClientID, Name> = new Map

  private readonly groups: Map<string, Emitter<ClientID>> = new Map

  private readonly creators: Map<ClientID, SafeSingleEmitter<RTCSessionDescriptionInit>> = new Map

  private readonly acceptors: Map<ClientID, SafeSingleEmitter<RTCSessionDescriptionInit>> = new Map

  /** Received some Data from the Server */
  private readonly message = new Emitter<DataView>(data => {
    if (this.groupFinal.triggered) {
      const { from, sdp } = parseSdp(data)
      this.acceptors.get(from)?.activate(sdp)
    } else
      switch (data.getUint8(0)) {
        case Code.CLIENT_JOIN:
          this.clientJoin.activate(parseClientJoin(data))
          return

        case Code.CLIENT_LEAVE:
          this.clientLeave.activate(parseClientLeave(data))
          return

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
                action: (accept) => this.server.send(buildProposal(accept, ...members))
              })
            } else
              this.groups.get(hash)!.activate(actor)
          } else {
            this.groups.get(hash)?.cancel()
            this.groups.delete(hash)
          }
          return

        case Code.GROUP_FINAL:
          const { code, members: ids, cmp } = parseGroupFinalize(data),
            emitters = new Map<ClientID, Opener | Closer>()
          
          // TODO make better!
          for (const other of ids) {
            this.acceptors.set(other, new SafeSingleEmitter<RTCSessionDescriptionInit>())
            this.creators.set(other, new SafeSingleEmitter<RTCSessionDescriptionInit>(sdp => this.server.send(buildSdp(other, sdp))))

            // The `cmp` is sent from the server as a way to determine what is can be true on all instances.
            if (cmp < other) // we should be opener (send offer, accept answer)
              emitters.set(other, {
                createOffer: this.creators.get(other)!.activate,
                acceptAnswer: this.acceptors.get(other)!.event,
              })
            else // we should be closer (accept offer, send answer)
              emitters.set(other, {
                acceptOffer: this.acceptors.get(other)!.event,
                createAnswer: this.creators.get(other)!.activate,
              })
          }

          this.groupFinal.activate({ code, members: emitters })
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
  // TODO deactivate on errors
  readonly groupFinal = new SafeSingleEmitter<{
    code: number
    members: Map<ClientID, Opener | Closer>
  }>()

  constructor(address: string, lobby: LobbyID, name: Name) {
    this.server = new WebSocket(address)
    this.server.addEventListener('open', () => this.server.send(buildIntro(lobby, name)))
    this.server.addEventListener('close', this.message.cancel)
    this.server.addEventListener('error', ev => this.message.deactivate(Error(`Connection to Server closed unexpectedly. ${ev}`)))
    this.server.addEventListener('message', async ({ data }) => data instanceof Blob
      && this.message.activate(new DataView(await data.arrayBuffer())))
  }

  // should activate group initiate?
  proposeGroup = (...ids: ClientID[]) => this.server.send(buildProposal(true, ...ids))

  close = () => this.server.close()
}
