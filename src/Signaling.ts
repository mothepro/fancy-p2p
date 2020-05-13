import { SafeSingleEmitter, SafeEmitter, Emitter } from 'fancy-emitter'
import type { ClientID, Name, LobbyID } from '@mothepro/signaling-lobby'
import { parseGroupFinalize, parseGroupChange, parseClientLeave, parseClientJoin, parseSdp } from '../util/parsers.js'
import { buildProposal, buildIntro, buildSdp } from '../util/builders.js'
import { Code } from '../util/constants.js'
import Client from './Client.js'
import ClientError from '../util/ClientError.js'
import HashableSet from '../util/HashableSet.js'

/**
 * Handle the communication with the signaling server.
 * 
 * Joins the lobby on server upon construction.
 * Allows for creation, approval and rejection of groups.
 * Listening on the `groupFinal` emitter will tell caller which offers/answers to create/accept
 */
export default class {

  /** Socket to signaling server. */
  private readonly server!: WebSocket

  /** Map of all clients connected to this signaling server. */
  private readonly allClients: Map<ClientID, Client> = new Map

  private readonly groups: Map<string, Emitter<Client>> = new Map

  /** Closes connection to server. */
  readonly close = () => this.server.close()

  /** Activated when our connection to signaling server is established. */
  readonly ready = new SafeSingleEmitter(() => this.server.send(buildIntro(this.lobby, this.name)))

  /** Activated when anyone initiates a new group. */
  readonly initiator: SafeEmitter<{
    /** The client who proposed this group. not present if you created the group */
    client?: Client
    /** The members in this group. */
    members: Client[]
    /** Function to accept or reject the group, not present if you created the group */
    action?(accept: boolean): void
    /** Activated with the Client who just accepted the group proposal. Deactivates when someone rejects. */
    ack: Emitter<Client>
  }> = new SafeEmitter

  readonly finalized: SafeSingleEmitter<{
    code: number
    members: Client[]
  }> = new SafeSingleEmitter

  /** Activated when a new client joins the lobby. */
  readonly join: SafeEmitter<Client> = new SafeEmitter

  /**
   * Activates when receiving some data from the signaling server.
   * Deactivates on connection error.
   * Cancels when connection ends gracefully.
   */
  private readonly message = new Emitter<DataView>(data => {
    try {
      if (this.finalized.triggered) {
        const { from, sdp } = parseSdp(data)
        this.getClient(from).acceptor.activate(sdp)
      } else
        switch (data.getUint8(0)) {
          case Code.CLIENT_JOIN:
            const { id, name } = parseClientJoin(data),
              client = new Client(id, name)
            this.join.activate(client)
            this.allClients.set(id, client)

            // Clean up on disconnect
            client.disconnect.once(() => this.allClients.delete(id))
            // Send SDP when creating
            client.creator.once(sdp => this.server.send(buildSdp(id, sdp)))
            // Activate the global initiator when a client initiates a group
            client.initiator.on(data => this.initiator.activate({...data, client}))
            break

          case Code.CLIENT_LEAVE:
            this.getClient(parseClientLeave(data)).disconnect.activate()
            break

          case Code.GROUP_REJECT:
          case Code.GROUP_REQUEST:
            const { approve, actor, members } = parseGroupChange(data)

            if (approve) {
              // Initiate the group if it hasn't been propopsed before
              if (!this.groups.has(members.hash)) {
                this.getClient(actor).initiator.activate({
                  members: [...members].map(this.getClient),
                  ack: this.groups.get(members.hash)!,
                  action: (accept) => this.server.send(buildProposal(accept, ...members))
                })
                // Keep track of clients when they accept or reject
                this.groups.set(members.hash, new Emitter)
              }
              // TODO decide if that should be in an else
              this.groups.get(members.hash)!.activate(this.getClient(actor))
            } else {
              this.groups.get(members.hash)?.deactivate(new ClientError(`Group with ${members} was rejected.`, this.getClient(actor)))
              this.groups.delete(members.hash)
            }
            return

          case Code.GROUP_FINAL:
            const { code, members: ids, cmp } = parseGroupFinalize(data)

            for (const clientId of ids)
              // The `cmp` is sent from the server as a way to determine
              // What expression will evaluate the same on both sides of the equation...
              this.getClient(clientId).isOpener.activate(cmp < clientId)

            this.finalized.activate({ code, members: [...ids].map(this.getClient) })
            return
        }
    } catch (err) {
      this.message.deactivate(err)
    }
  })


  constructor(address: string, private readonly lobby: LobbyID, private readonly name: Name) {
    try {
      this.server = new WebSocket(address)
      this.server.addEventListener('open', this.ready.activate)
      this.server.addEventListener('close', this.message.cancel)
      this.server.addEventListener('error', ev => this.message.deactivate(Error(`Connection to Server closed unexpectedly. ${ev}`)))
      this.server.addEventListener('message', async ({ data }) => data instanceof Blob
        && this.message.activate(new DataView(await data.arrayBuffer())))
    } catch (err) {
      this.message.deactivate(err)
    }
  }

  // TODO make DRY with `message` switch case
  proposeGroup = (...members: Client[]) => {
    const ids: HashableSet<ClientID> = new HashableSet

    // TODO improve this
    for (const [id, client] of this.allClients)
      if (members.includes(client))
        ids.add(id)

    if (this.groups.has(ids.hash))
      throw Error('Can not propose a group that is already formed.')
      
      if (ids.size < 1)
      throw Error('Can not propose a group without members.')
      
    const ack = new Emitter<Client>()
    this.initiator.activate({ members, ack })
    this.groups.set(ids.hash, ack)
    this.server.send(buildProposal(true, ...ids))
  }

  /** Attempts to get a client that has connected. Throws if unable to. */
  private getClient(id: ClientID) {
    if (!this.allClients.has(id))
      throw Error(`Received data from unknown client ${id}.`)
    return this.allClients.get(id)!
  }
}
