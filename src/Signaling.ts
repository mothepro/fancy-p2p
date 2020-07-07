import { SafeEmitter, Emitter, filterValue, filter } from 'fancy-emitter'
import type { ClientID, Name, LobbyID } from '@mothepro/signaling-lobby'
import { parseGroupFinalize, parseGroupChange, parseClientLeave, parseClientJoin, parseSdp, parseYourName } from '../util/parsers.js'
import { buildProposal, buildSdp } from '../util/builders.js'
import Client, { SimpleClient, MockClient } from './Client.js'
import HashableSet from '../util/HashableSet.js'
import { Code } from '../util/constants.js'

class LeaveError extends Error {
  constructor(
    readonly client?: Client,
    message?: string,
  ) { super(message) }
}

export const enum State {
  /** Connection with server is not yet open, i.e. closed. */
  CLOSED,
  
  /** When our connection to signaling server is established. */
  READY,

  /** A group has been finalized and peers can began establishing direct connections. */
  FINALIZED,
}

/**
 * Handle the communication with the signaling server.
 * 
 * Joins the lobby on server upon construction.
 * Allows for creation, approval and rejection of groups.
 * Listening on the `groupFinal` emitter will tell caller which offers/answers to create/accept
 */
export default class {

  self?: MockClient

  /** Socket to signaling server. */
  private readonly server!: WebSocket

  /** Map of all clients connected to this signaling server. */
  private readonly allClients: Map<ClientID, Client> = new Map

  private readonly groups: Map<string, Emitter<SimpleClient>> = new Map

  private state = State.CLOSED

  readonly stateChange: Emitter<State> = new Emitter(newState => this.state = newState)

  /** Nonce generated by the server after finalization. */
  code?: number

  /** My ID on the signaling server once finalized. */
  myId?: ClientID

  /** Clients we have finalized with. */
  members?: Client[]

  /** Activated when a new client joins the lobby. */
  readonly connection: SafeEmitter<SimpleClient> = new SafeEmitter

  /** Activates when receiving some data from the signaling server. */
  private readonly message = new SafeEmitter<DataView>(data => {
    try {
      if (this.state == State.FINALIZED) {
        // Accept the SDP from the client after they have created.
        const { from, sdp } = parseSdp(data)
        this.getClient(from).acceptor.activate(sdp)
        return
      }
      
      switch (data.getUint8(0)) {
        case Code.YOUR_NAME:
          this.connection.activate(this.self = new MockClient(parseYourName(data)))
          return

        case Code.CLIENT_JOIN:
          this.handleClientJoin(parseClientJoin(data))
          return

        case Code.CLIENT_LEAVE:
          this.getClient(parseClientLeave(data)).proposals.cancel()
          return

        case Code.GROUP_REJECT:
        case Code.GROUP_REQUEST:
          this.handleGroupChange(parseGroupChange(data))
          return

        case Code.GROUP_FINAL:
          this.handleGroupFinalize(parseGroupFinalize(data))
          return

        default:
          throw Error(`Unexpected data from server ${data}`)
      }
    } catch (err) {
      this.stateChange.deactivate(err)
    }
  })

  private async handleClientJoin({ id, name }: ReturnType<typeof parseClientJoin>) {
    const client = new Client(id, name)

    this.allClients.set(id, client)
    this.sendSdpOnCreation(client)

    if (this.connection.count == 0) // Ensure the SelfPeer comes out first, otherwise, just wait for it
      await this.connection.next
    this.connection.activate(client)

    // Clean up on disconnect
    for await (const _ of client.proposals);
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
        this.getClient(actor).proposals.activate({
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
    this.code = code
    this.myId = cmp
    this.members = [...members].map(this.getClient)

    for (const member of this.members)
      // The `cmp` is sent from the server as a way to determine
      // What expression will evaluate the same on both sides of the equation...
      member.isOpener = cmp < member.id

    this.stateChange.activate(State.FINALIZED)
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

  private async sendSdpOnCreation({ id, creator }: Client) {
    for await (const sdp of creator)
      this.serverSend(buildSdp(id, sdp))
  }

  constructor(address: URL | string, lobby: LobbyID, name?: Name, protocol?: string | string[]) {
    if (typeof address == 'string')
      address = new URL(address)
    address.searchParams.set('lobby', lobby)
    if (name)
      address.searchParams.set('name', name)

    this.server = new WebSocket(address.toString(), protocol)
    this.server.binaryType = 'arraybuffer'
    this.server.addEventListener('open', () => this.stateChange.activate(State.READY))
    this.server.addEventListener('close', () => this.stateChange.activate(State.CLOSED))
    this.server.addEventListener('error', () => this.stateChange.deactivate(Error('Connection to Server closed unexpectedly.')))
    this.server.addEventListener('message', async ({ data }) => this.message.activate(new DataView(data)))

    // Close connection on error or completion
    filterValue(this.stateChange, State.CLOSED).finally(() => this.server.close())
      .catch(() => { }) // handle error elsewhere

    // Activate connection with self once ready, if the server won't assign the name
    if (name)
      filterValue(this.stateChange, State.READY)
        .then(() => setTimeout(this.connection.activate, 0, this.self = new MockClient(name)))
  }

  /** Proposes a group to the server and returns the emitter that will be activated when clients accept it. */
  proposeGroup(...members: SimpleClient[]) {
    const ids: HashableSet<ClientID> = new HashableSet

    for (const [id, client] of this.allClients)
      if (members.includes(client))
        ids.add(id)

    if (this.state != State.READY)
      throw Error('Can not propose a group before connecting.')

    if (this.groups.has(ids.hash))
      throw Error('Can not propose a group that is already formed.')

    if (ids.size < 1)
      throw Error('Can not propose a group without members.')

    const ack: Emitter<SimpleClient> = new Emitter
    this.serverSend(buildProposal(true, ...ids))
    this.groups.set(ids.hash, ack)
    this.self!.proposals.activate({ members, ack })

    return this.groups.get(ids.hash)!
  }

  groupExists(...members: SimpleClient[]) {
    const ids: HashableSet<ClientID> = new HashableSet

    // TODO improve this??
    // for some reason this allows members to include self.
    for (const [id, client] of this.allClients)
      if (members.includes(client))
        ids.add(id)

    return !!ids.size && this.groups.has(ids.hash)
  }
}
