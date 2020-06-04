import { SafeSingleEmitter, SingleEmitter, SafeEmitter, Emitter } from 'fancy-emitter'
import { ClientID, Name, LobbyID, Code } from '@mothepro/signaling-lobby'
import { parseGroupFinalize, parseGroupChange, parseClientLeave, parseClientJoin, parseSdp } from '../util/parsers.js'
import { buildProposal, buildSdp } from '../util/builders.js'
import Client, { SimpleClient, MockClient } from './Client.js'
import HashableSet from '../util/HashableSet.js'

class LeaveError extends Error {
  constructor(
    readonly client?: Client,
    message?: string,
  ) { super(message) }
}

/**
 * Handle the communication with the signaling server.
 * 
 * Joins the lobby on server upon construction.
 * Allows for creation, approval and rejection of groups.
 * Listening on the `groupFinal` emitter will tell caller which offers/answers to create/accept
 */
export default class {

  private self?: MockClient

  /** Socket to signaling server. */
  private readonly server!: WebSocket

  /** Map of all clients connected to this signaling server. */
  private readonly allClients: Map<ClientID, Client> = new Map

  private readonly groups: Map<string, Emitter<SimpleClient>> = new Map

  /** Activated when our connection to signaling server is established. */
  readonly ready = new SafeSingleEmitter

  /** Connection with server should close */
  readonly close = new SingleEmitter(() => this.server.close())

  readonly finalized: SafeSingleEmitter<{
    code: number
    myId: ClientID
    members: Client[]
  }> = new SafeSingleEmitter

  /** Activated when a new client joins the lobby. */
  readonly connection: SafeEmitter<SimpleClient> = new SafeEmitter

  /** Activates when receiving some data from the signaling server. */
  private readonly message = new SafeEmitter<DataView>(data => {
    try {
      if (this.finalized.triggered) {
        // Accept the SDP from the client after they have created.
        const { from, sdp } = parseSdp(data)
        this.getClient(from).acceptor.activate(sdp)
      } else
        switch (data.getUint8(0)) {
          case Code.CLIENT_JOIN:
            this.handleClientJoin(parseClientJoin(data))
            break

          case Code.CLIENT_LEAVE:
            this.getClient(parseClientLeave(data)).propose.cancel()
            break

          case Code.GROUP_REJECT:
          case Code.GROUP_REQUEST:
            this.handleGroupChange(parseGroupChange(data))
            break

          case Code.GROUP_FINAL:
            this.handleGroupFinalize(parseGroupFinalize(data))
            break

          default:
            throw Error(`Unexpected data from server ${data}`)
        }
    } catch (err) {
      this.close.deactivate(err)
      this.server.close()
    }
  })

  private async handleClientJoin({ id, name }: ReturnType<typeof parseClientJoin>) {
    const client = new Client(id, name)
    this.connection.activate(client)
    this.allClients.set(id, client)

    // DM the SDP for the client after creation
    client.creator.on(sdp => this.serverSend(buildSdp(id, sdp)))

    // Clean up on disconnect
    for await (const _ of client.propose);
    this.allClients.delete(id)
  }

  private handleGroupChange({ approve, actor, members }: ReturnType<typeof parseGroupChange>) {
    const rejectGroup = (reason: Error) =>
      this.groups.get(members.hash)?.deactivate(reason)
      && this.groups.delete(members.hash)

    if (approve) {
      // Initiate the group if it hasn't been propopsed before
      if (!this.groups.has(members.hash)) {
        // Used to keep track of clients when they accept or reject
        this.groups.set(members.hash, new Emitter)
        // Initiate on behalf of the client
        this.getClient(actor).propose.activate({
          members: [...members].map(this.getClient),
          ack: this.groups.get(members.hash)!,
          action: accept => {
            this.serverSend(buildProposal(accept, ...members))
            if (!accept)
              rejectGroup(new Error(`Rejected group with ${[...members]}.`))
          }
        })
      }
      // TODO decide if that should be in an else
      this.groups.get(members.hash)!.activate(this.getClient(actor))
    } else
      rejectGroup(new LeaveError(this.allClients.get(actor), `Group with ${[...members]} was rejected.`))
  }

  private handleGroupFinalize({ code, members, cmp }: ReturnType<typeof parseGroupFinalize>) {
    for (const clientId of members)
      // The `cmp` is sent from the server as a way to determine
      // What expression will evaluate the same on both sides of the equation...
      this.getClient(clientId).isOpener.activate(cmp < clientId)

    this.finalized.activate({ code, myId: cmp, members: [...members].map(this.getClient) })
  }

  /** Attempts to get a client that has connected. Throws if unable to. */
  private readonly getClient = (id: ClientID) => {
    if (!this.allClients.has(id))
      throw Error(`Received data from unknown client ${id}.`)
    return this.allClients.get(id)!
  }

  /** A wrapper around socket send since that method doesn't throw, for some reason. */
  private serverSend(data: ArrayBuffer) {
    if (this.server.readyState != WebSocket.OPEN)
      throw Error('WebSocket is not in an OPEN state.')
    this.server.send(data)
  }

  constructor(address: URL | string, lobby: LobbyID, name: Name, protocol?: string | string[]) {
    if (typeof address == 'string')
      address = new URL(address)
    address.searchParams.set('lobby', lobby)
    address.searchParams.set('name', name)

    this.server = new WebSocket(address.toString(), protocol)
    this.server.binaryType = 'arraybuffer'
    this.server.addEventListener('open', this.ready.activate)
    this.server.addEventListener('close', this.close.activate)
    this.server.addEventListener('error', () => this.close.deactivate(Error('Connection to Server closed unexpectedly.')))
    this.server.addEventListener('message', async ({ data }) => this.message.activate(new DataView(data)))

    // Activate connection with self once ready
    this.ready.once(() => setTimeout(this.connection.activate, 0, this.self = new MockClient(name)))
  }

  /** Proposes a group to the server and returns the emitter that will be activated when clients accept it. */
  proposeGroup(...members: SimpleClient[]) {
    const ids: HashableSet<ClientID> = new HashableSet

    // TODO improve this??
    // for some reason this allows members to include self.
    for (const [id, client] of this.allClients)
      if (members.includes(client))
        ids.add(id)

    if (!this.ready.triggered)
      throw Error('Can not propose a group before connecting.')

    if (this.groups.has(ids.hash))
      throw Error('Can not propose a group that is already formed.')

    if (ids.size < 1)
      throw Error('Can not propose a group without members.')

    const ack: Emitter<SimpleClient> = new Emitter
    this.serverSend(buildProposal(true, ...ids))
    this.groups.set(ids.hash, ack)
    this.self!.propose.activate({ members, ack })

    return this.groups.get(ids.hash)!
  }
}
