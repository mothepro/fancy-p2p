import { SafeSingleEmitter, SafeEmitter, Emitter } from 'fancy-emitter'
import type { ClientID, Name, LobbyID } from '@mothepro/signaling-lobby'
import { Code } from '../util/constants.js'
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

  private readonly groups: Map<string, Emitter<ClientID>> = new Map

  private readonly acceptors: Map<ClientID, SafeSingleEmitter<RTCSessionDescriptionInit>> = new Map

  /** Activated when connection to server is established. */
  readonly ready = new SafeSingleEmitter(() => this.server.send(buildIntro(this.lobby, this.name)))

  /** Activated when a client join message is received. */
  readonly join: SafeEmitter<{
    id: ClientID
    name: Name
  }> = new SafeEmitter

  /** Activated when a client leave message is received. */
  readonly leave: SafeEmitter<ClientID> = new SafeEmitter

  /** Activated when a group proposal/ack message is received. */
  readonly groupInitiate: SafeEmitter<{
    /** The members in this group */
    members: ClientID[]
    /** Function to accept or reject the group, not included if you created the group */
    action?(accept: boolean): void
    /** The id of client just accepted the group. Cancelled when someone rejects. */
    ack: Emitter<ClientID>
  }> = new SafeEmitter

  /** Activated when a group finalization message is received. */
  // TODO cancel all other emitters?
  // TODO deactivate on errors
  readonly groupFinal: SafeSingleEmitter<{
    code: number
    members: Map<ClientID, Opener | Closer>
  }> = new SafeSingleEmitter

  /** Received some Data from the Server */
  private readonly message = new Emitter<DataView>(data => {
    if (this.groupFinal.triggered) {
      const { from, sdp } = parseSdp(data)
      this.acceptors.get(from)?.activate(sdp)
    } else
      switch (data.getUint8(0)) {
        case Code.CLIENT_JOIN:
          this.join.activate(parseClientJoin(data))
          return

        case Code.CLIENT_LEAVE:
          this.leave.activate(parseClientLeave(data))
          return

        case Code.GROUP_REJECT:
        case Code.GROUP_REQUEST:
          const { approve, actor, members } = parseGroupChange(data),
            hash = members.sort().toString()

          if (approve) {
            // Initiate the group if it hasn't been propopsed before
            if (!this.groups.has(hash)) {
              this.groups.set(hash, new Emitter<ClientID>().activate(actor))
              this.groupInitiate.activate({
                members,
                ack: this.groups.get(hash)!,
                action: (accept) => this.server.send(buildProposal(accept, ...members))
              })
            } else
              this.groups.get(hash)!.activate(actor)
          } else {
            this.groups.get(hash)?.cancel() // TODO, worth it to deactivate with ID of leaver?
            this.groups.delete(hash)
          }
          return

        case Code.GROUP_FINAL:
          const { code, members: ids, cmp } = parseGroupFinalize(data),
            emitters = new Map<ClientID, Opener | Closer>()

          // TODO make better!
          for (const other of ids) {
            const create = new SafeSingleEmitter<RTCSessionDescriptionInit>(sdp => this.server.send(buildSdp(other, sdp)))
            this.acceptors.set(other, new SafeSingleEmitter<RTCSessionDescriptionInit>())

            // The `cmp` is sent from the server as a way to determine what is can be true on all instances.
            if (cmp < other) // we should be a opener (send offer -> accept answer)
              emitters.set(other, {
                createOffer: create.activate,
                acceptAnswer: this.acceptors.get(other)!.event,
              })
            else // we should be a closer (accept offer -> send answer)
              emitters.set(other, {
                acceptOffer: this.acceptors.get(other)!.event,
                createAnswer: create.activate,
              })
          }

          this.groupFinal.activate({ code, members: emitters })
          return
      }
  })

  constructor(address: string, private readonly lobby: LobbyID, private readonly name: Name) {
    this.server = new WebSocket(address)
    this.server.addEventListener('open', this.ready.activate)
    this.server.addEventListener('close', this.message.cancel)
    this.server.addEventListener('error', ev => this.message.deactivate(Error(`Connection to Server closed unexpectedly. ${ev}`)))
    this.server.addEventListener('message', async ({ data }) => data instanceof Blob
      && this.message.activate(new DataView(await data.arrayBuffer())))
  }

  // TODO make DRY with `message` switch case
  proposeGroup = (...members: ClientID[]) => {
    const hash = members.sort().toString()

    if (this.groups.has(hash))
      throw Error('Can not propose a group that is already formed.')
    
    const ack = new Emitter<ClientID>()
    this.groupInitiate.activate({ members, ack })
    this.groups.set(hash, ack)
    this.server.send(buildProposal(true, ...members))
  }

  close = () => this.server.close()
}
