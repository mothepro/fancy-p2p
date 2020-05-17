import { SafeEmitter, Emitter, SafeListener } from 'fancy-emitter'
import type { Sendable } from '@mothepro/ez-rtc'
import type { Name, LobbyID } from '@mothepro/signaling-lobby'
import type { SimpleClient } from './Client.js'
import Peer, { SimplePeer } from './Peer.js'
import { Max } from '../util/constants.js'
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
  readonly stateChange = new Emitter<State>(newState => (this.state as State) = newState)

  /** The peers who's connections are still open */
  readonly peers: Set<SimplePeer<T>> = new Set

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
  readonly broadcast: (data: T) => void = data => this.assert(State.READY)
    && [...this.peers].map(peer => peer.send(data))

  constructor(
    server: string,
    private readonly stuns: string[],
    lobby: LobbyID,
    name: Name,
    /** Number of times to attempt to make an RTC connection. */
    private readonly retries = 1,
    /** If greater than 0, the number of milliseconds to wait before giving up on the connection. */
    private readonly timeout = 0,
  ) {
    this.server = new Signaling(server, lobby, name)

    // Bind states across classes
    this.server.ready.once(() => this.stateChange.activate(State.LOBBY))
    this.server.finalized.once(() => this.stateChange.activate(State.LOADING))

    // Bind Emitters
    this.connection = this.server.connection
    this.bindClient()
    this.bindFinalization()
    this.bindServerClose()
  }

  private async bindClient() {
    for await (const client of this.connection)
      // Bind the client `initiator`s to this `initiator`
      client.initiator.on(data => this.initiator.activate({ ...data, client }))
  }

  private async bindFinalization() {
    const { code, members } = await this.server.finalized.event,
      peers: Peer<T>[] = []

    this.rng = rng(code)
    for (const client of members)
      peers.push(new Peer<T>(this.stuns, client, this.retries, this.timeout))

    try {
      // Every connection is connected successfully, ready up & close connection with server
      await Promise.all(peers.map(({ ready: { event } }) => event))
      for (const peer of peers)
        this.savePeer(peer)
      this.stateChange.activate(State.READY)
    } catch (err) {
      this.stateChange.deactivate(err)
    }
    this.server.close.activate()
  }

  // Make sure to deactivate the `stateChange` if the server connection closes prematurely or with an error.
  private async bindServerClose() {
    try {
      await this.server.close.event
      // TODO SingleEmitter resolves faster than Emitter... Fix in fancy-emitter
      // this.assert(State.READY, 'Connection with server closed prematurely')
      if (!this.peers.size)
        throw Error('Connection with server closed prematurely')
    } catch (err) {
      this.stateChange.deactivate(err)
    }
  }

  /** Save a peer to the instance, removes when connection ends. */
  private async savePeer(peer: SimplePeer<T>) {
    this.peers.add(peer)
    try {
      for await (const _ of peer.message);
    } catch { } // Swallow errors
    this.peers.delete(peer)
  }
}
