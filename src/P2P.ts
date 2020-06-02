import { SafeEmitter, Emitter, SafeListener } from 'fancy-emitter'
import type { Sendable } from '@mothepro/ez-rtc'
import { Name, LobbyID, Max, ClientID } from '@mothepro/signaling-lobby'
import Client, { SimpleClient } from './Client.js'
import Peer, { SimplePeer, MockPeer } from './Peer.js'
import rng from '../util/random.js'
import Signaling from './Signaling.js'

/** Represent where we are in the process of connecting to some peers. */
export const enum State {
  /** Still attempting to connect to the server. */
  OFFLINE,

  /** We are now connected to the server in lobby, waiting to make a group or join a group. */
  LOBBY,

  /** We have accepted a group and trying to make the RTCs. */
  LOADING,

  /** The connections with peers are set and we can now broadcast messages. */
  READY,
}

export default class <T extends Sendable = Sendable> {

  readonly state: State = State.OFFLINE
  private readonly server: Signaling

  /** Activated when the state changes, Cancels when finalized, Deactivates when error is throw. */
  readonly stateChange = new Emitter<State>(
    newState => (this.state as State) = newState,
    state => state == State.READY && this.server.close.activate())

  /** The peers who's connections are still open */
  readonly peers: SimplePeer<T>[] = []

  /** Generator for random integers that will be consistent across connections within [-2 ** 31, 2 ** 31). */
  private rng?: Generator<number, never, void>

  /** Activated when a client joins the lobby. */
  readonly connection: SafeListener<SimpleClient>

  /** Activated when anyone initiates a new group. */
  readonly initiator: SafeEmitter<{
    /** The client who proposed this group. not present if you created the group */
    client?: SimpleClient
    /** The members in this group. */
    members: SimpleClient[]
    /** Function to accept or reject the group, not present if you created the group */
    action?(accept: boolean): void
    /** Activated with the Client who just accepted the group proposal. Deactivates when someone rejects. */
    ack: Emitter<SimpleClient>
  }> = new SafeEmitter

  // TODO allow READY state even tho the state doesn't change until the next tick
  protected assert(valid: State, message = `Expected state to be ${valid} but was ${this.state}`) {
    if (this.state != valid)
      throw Error(message)
    return true as const
  }

  /**
   * Generates a random number in [0,1). Same as Math.random()
   * If `isInt` is true, than a integer in range [-2 ** 31, 2 ** 31) is generated.
   * 
   * Throws if group has yet to be finalized.
   */
  readonly random = (isInt = false) => this.assert(State.READY)
    && isInt
    ? this.rng!.next().value
    : 0.5 + this.rng!.next().value / Max.INT

  /** Propose a group with other clients connected to this lobby. */
  readonly proposeGroup: (...members: SimpleClient[]) => void = (...members) => this.assert(State.LOBBY)
    && this.initiator.activate({ members, ack: this.server.proposeGroup(...members) })

  /** Send data to all connected peers. */
  readonly broadcast = (data: T, includeSelf = true) => {
    this.assert(State.READY)
    for (const peer of this.peers)
      if (peer.message.isAlive && (includeSelf || !peer.isYou))
        peer.send(data)
  }

  constructor(
    { name, stuns, lobby, server: { address, version }, retries = 1, timeout = -1 }: {
      /** Name used which find other clients in lobby. */
      name: Name
      /** STUN servers to use to initialize P2P connections */
      stuns: string[]
      /** Lobby ID to use for this app */
      lobby: LobbyID
      /** Settings for the signaling server */
      server: {
        /** The address of the signaling server */
        address: URL
        /** The version of `@mothepro/signaling-lobby` the signaling server is running */
        version: string
      }
      /** Number of times to attempt to make an RTC connection. Defaults to 1 */
      retries?: number
      /** The number of milliseconds to wait before giving up on the connection. Doesn't give up by default */
      timeout?: number
    }) {
    this.server = new Signaling(address, lobby, name, version)

    // Bind states across classes
    this.server.ready.once(() => this.stateChange.activate(State.LOBBY))
    this.server.finalized.once(() => this.stateChange.activate(State.LOADING))

    // Bind Emitters
    this.connection = this.server.connection
    this.bindClient()
    this.bindFinalization(name, stuns, retries, timeout)
    this.bindServerClose()
  }

  private async bindClient() {
    for await (const client of this.connection)
      // Bind the client `initiator`s to this `initiator`
      client.initiator.on(data => this.initiator.activate({ ...data, client }))
  }

  private async bindFinalization(myName: Name, stuns: string[], retries: number, timeout: number) {
    const { code, members, myId } = await this.server.finalized.event,
      memberMap: Map<ClientID, Client> = new Map,
      ids: ClientID[] = [myId],
      readies: Promise<void>[] = []

    this.rng = rng(code)

    for (const client of members) {
      memberMap.set(client.id, client)
      ids.push(client.id)
    }

    // sort the IDs then use a consistent fisher yates shuffle on them
    ids.sort((a, b) => a - b)
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.abs(this.rng.next().value) % i;
      [ids[j], ids[i]] = [ids[i], ids[j]]
    }

    // If the ID is in the map add a real peer in it's place, otherwise just a mock will do
    for (const id of ids)
      if (memberMap.has(id)) {
        const peer = new Peer<T>(stuns, memberMap.get(id)!, retries, timeout)
        readies.push(peer.ready.event)
        this.peers.push(peer)
      } else
        this.peers.push(new MockPeer(myName))

    try {
      // Every connection is connected successfully, ready up & close connection with server
      await Promise.all(readies)
      this.stateChange.activate(State.READY)
    } catch (err) {
      this.stateChange.deactivate(err)
    }
  }

  // Make sure to deactivate the `stateChange` if the server connection closes prematurely or with an error.
  private async bindServerClose() {
    try {
      await this.server.close.event
      this.assert(State.READY, 'Connection with server closed prematurely')
    } catch (err) {
      this.stateChange.deactivate(err)
    }
  }
}
