import { SafeEmitter, Emitter, SafeSingleEmitter, SingleEmitter, Listener } from 'fancy-emitter'
import type { ClientID, Name } from '@mothepro/signaling-lobby'
import { Code } from '../util/constants'
import { parseClientLeave, parseGroupChange, parseGroupFinalize, parseSdp } from '../util/parsers'
import { buildProposal } from '../util/builders'

interface Opener {
  createOffer(sdp: RTCSessionDescriptionInit): void
  acceptAnswer: Promise<RTCSessionDescriptionInit>
}

interface Closer {
  acceptOffer: Promise<RTCSessionDescriptionInit>
  createAnswer(sdp: RTCSessionDescriptionInit): void
}

/** Represents another client in the same lobby and signaling server as we are. */
export default class Client {
  /**
   * Activates when group is finalized.
   * Resolves with whether this connection should be an opener or closer.
   */ 
  readonly isOpener: SafeSingleEmitter<boolean> = new SafeSingleEmitter

  /** Activated when this client leaves. */
  readonly disconnect = new SingleEmitter(() => Client.allClients.delete(this.id))

  /** Activated when a initiating a new group. */
  readonly groupInitiate: SafeEmitter<{
    /** The members in this group, beside me and you. */
    others: Client[]
    /** Function to accept or reject the group, not included if you created the group */
    action?(accept: boolean): void
    /** Activated with the Client who just accecepted the group proposal. Cancelled when someone rejects. */
    ack: Emitter<Client>
  }> = new SafeEmitter

  readonly creator: SafeSingleEmitter<RTCSessionDescriptionInit> = new SafeSingleEmitter

  readonly acceptor: SafeSingleEmitter<RTCSessionDescriptionInit> = new SafeSingleEmitter

  public static joined({ id, name }: { id: ClientID, name: Name }, message: Listener<DataView>) {
    if (Client.allClients.has(id))
      throw Error(`Client with ${id} tried to connect to the same lobby`)
    
    const client = new Client(id, name, message)
    Client.allClients.set(id, client)
    return client
  }

  private constructor(
    private readonly id: ClientID,
    readonly name: Name,
    /** Activates when a message is recieved from the server. */
    private readonly message: Listener<DataView>,
  ) {}

  private readonly groups: Map<string, Emitter<Client>> = new Map

  /**
   * Turns a list of client IDs to a hashed string
   * Sort order doesn't matter as long as it is always consistent
   */
  private static readonly hashIds = (...ids: ClientID[]) => ids.sort().join()

  private static readonly allClients: Map<ClientID, Client> = new Map

  static readonly onMessage = new SafeEmitter<DataView>(data => {
    if (this.isOpener.triggered) {
      const { from, sdp } = parseSdp(data)
      if (this.id == from)
        this.acceptor.activate(sdp)
    } else
      switch (data.getUint8(0)) {
        case Code.CLIENT_LEAVE:
          Client.allClients.get(parseClientLeave(data))?.disconnect.activate()
          return

        case Code.GROUP_REJECT:
        case Code.GROUP_REQUEST:
          const { approve, actor, members } = parseGroupChange(data),
            hash = members.sort().toString()

          if (this.id == actor)
            if (approve) {
              // Initiate the group if it hasn't been propopsed before
              if (!this.groups.has(hash)) {
                this.groups.set(hash, new Emitter<Client>().activate(this))

                this.groupInitiate.activate({
                  members,
                  ack: this.groups.get(hash)!,
                  action: (accept) => this.server.send(buildProposal(accept, ...members))
                })
              } else
                this.groups.get(hash)!.activate(this)
            } else {
              this.groups.get(hash)?.cancel() // TODO, worth it to deactivate with ID of leaver?
              this.groups.delete(hash)
            }
          return

        case Code.GROUP_FINAL:
          const { members: ids, cmp } = parseGroupFinalize(data)

          if (ids.includes(this.id))
            // The `cmp` is sent from the server as a way to determine
            // What expression will evaluate the same on both sides of the equation...
            this.isOpener.activate(cmp < this.id)
          return
      }
  })
}
