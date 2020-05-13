import { SafeSingleEmitter, SafeEmitter, Emitter, SingleEmitter, SafeListener } from 'fancy-emitter'
import Connection, { State as RTCState, Sendable } from '@mothepro/ez-rtc'
import type { Name, LobbyID } from '@mothepro/signaling-lobby'
import { Max } from './util/constants.js'
import rng from './src/random.js'
import Signaling from './src/Signaling.js'
import Client from './src/Client.js'

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

  private state = State.OFFLINE
  private readonly server: Signaling

  /** Activated when the state changes, Cancels when finalized, Deactivates when error is throw.*/
  readonly stateChange = new Emitter<State>(newState => this.state = newState)

  /** Shortcut to the peers being available. */
  readonly ready = new SafeSingleEmitter(() => this.stateChange.activate(State.READY), () => this.server.close.activate)

  /** Generator for random integers that will be consistent across connections within [-2 ** 31, 2 ** 31). */
  rng?: Generator<number, never, void>

  /** Connections, once finalized */
  readonly peers: Set<{
    /** Name of the new peer. */
    name: Name
    /** Function to send data to activate the `message` Emitter for the peer. */
    send(data: T): void
    /** Activates when a message is received for this peer. */
    message: SafeEmitter<T>
  }> = new Set

  /** Activated when a client joins the lobby. */
  readonly connection: SafeListener<Client>

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

  protected assert(valid: State) {
    if (this.state != valid)
      throw Error(`Expected state to be ${valid} but was ${this.state}`)
    return true
  }

  /**
   * Generates a random number in [0,1). Same as Math.random()
   * If `isInt` is true, than a integer in range [-2 ** 31, 2 ** 31) is generated.
   * 
   * Throws if group has yet to be finalized.
   */
  readonly random: (isInt?: boolean) => number = (isInt = false) => this.assert(State.READY)
    && isInt
    ? this.rng!.next().value
    : 0.5 + this.random(true) / Max.INT

  /** Propose a group with other clients connected to this lobby. */
  readonly proposeGroup = (...members: Client[]) => this.assert(State.LOBBY)
    && this.initiator.activate({ members, ack: this.server.proposeGroup(...members) })

  /** Send data to all connected peers. */
  readonly broadcast = (data: T) => this.assert(State.READY)
    && [...this.peers].map(({ send }) => send(data))

  constructor(
    server: string,
    private readonly stuns: string[],
    lobby: LobbyID,
    name: Name,
  ) {
    this.server = new Signaling(server, lobby, name)

    // Bind states across classes
    this.server.ready.once(() => this.stateChange.activate(State.LOBBY))
    this.server.finalized.once(() => this.stateChange.activate(State.LOADING))

    // Bind Emitters
    this.connection = this.server.connection
    this.bindClient()
    this.bindFinalization()
    this.bindClose()
  }

  private async bindClient() {
    for await (const client of this.connection)
      // Bind the client `initiator`s to this `initiator`
      client.initiator.on(data => this.initiator.activate({ ...data, client }))
  }

  private async bindFinalization() {
    const allReady = [],
      { code, members } = await this.server.finalized.event

    // Seed RNG
    this.rng = rng(code)

    for (const client of members) {
      const conn = new Connection(this.stuns),
        ready = new SingleEmitter

      // Save this ready promise
      allReady.push(ready.event)

      // Ready promise should resolve once connceted
      conn.statusChange
        .on(state => state == RTCState.CONNECTED && ready.activate())
        .catch(ready.deactivate)

      // Save the functions to utilze this connection
      this.peers.add({
        name: client.name,
        send: (data) => conn.send(data),
        // @ts-ignore This cast should be okay
        message: conn.message,
      })

      // Openers should create offer -> accept answer
      try {
        if (await client.isOpener.event) {
          client.creator.activate(await conn.createOffer())
          conn.acceptSDP(await client.acceptor.event)
        } else { // Closers should accept offter -> create answer
          conn.acceptSDP(await client.acceptor.event)
          client.creator.activate(await conn.createAnswer())
        }
      } catch (err) {
        this.stateChange.deactivate(err)
      }
    }

    // Every connection is connected successfully
    try {
      await Promise.all(allReady)
      this.ready.activate()
    } catch (err) {
      this.stateChange.deactivate(err)
    }
  }

  private async bindClose() {
    // Make sure to deactivate the `stateChange` if the server close deactivates.
    try {
      await this.server.close
    } catch (err) {
      this.stateChange.deactivate(err)
    }
  }
}
