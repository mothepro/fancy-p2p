import { SafeEmitter, Emitter, SingleEmitter, SafeListener } from 'fancy-emitter'
import Connection, { State as RTCState, Sendable } from '@mothepro/ez-rtc'
import type { ClientID, Name, LobbyID } from '@mothepro/signaling-lobby'
import { Max } from '../util/constants.js'
import rng from './random.js'
import Signaling from './Signaling.js'

interface Peer<T extends Sendable> {
  name: Name
  send(data: T): void
  message: SafeEmitter<T>
}

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

  /** Activated when the state changes, Cancels when finalized, Deactivates when error is throw.*/
  readonly stateChange = new Emitter<State>(newState => this.state = newState)

  /** Generator for random integers that will be consistent across connections within [-2 ** 31, 2 ** 31). */
  rng?: Generator<number, never, void>

  /** Connections, once finalized */
  // TODO replace with a simple array after grouping.
  readonly peers: Map<ClientID, Peer<T>> = new Map

  private readonly server: Signaling

  /** Activated when a client join message is received. */
  // TODO hide ClientID
  readonly join: SafeListener<{
    id: ClientID
    name: Name
  }>

  /** Activated when a client leave message is received. */
  // TODO hide ClientID
  readonly leave: SafeListener<ClientID>

  /** Activated when a group proposal/ack message is received. */
  // TODO hide ClientID
  readonly propose: SafeListener<{
    /** The members in this group */
    members: ClientID[]
    /** Function to accept or reject the group, not included if you created the group */
    action?(accept: boolean): void
    /** The id of client just accepted the group. Cancelled when someone rejects. */
    ack: Emitter<ClientID>
  }>

  /**
   * Generates a random number in [0,1). Same as Math.random()
   * If `isInt` is true, than a integer in range [-2 ** 31, 2 ** 31) is generated.
   * 
   * Throws if group has yet to be finalized.
   */
  readonly random: (isInt?: boolean) => number = (isInt = false) =>
    this.assert(State.READY) && isInt
      ? this.rng!.next().value
      : 0.5 + this.random(true) / Max.INT

  protected assert(...validStates: State[]) {
    if (!new Set(validStates).has(this.state))
      throw Error(`Expected state to be ${validStates} but was ${this.state}`)
    return true
  }

  constructor(
    server: string,
    private readonly stuns: string[],
    lobby: LobbyID,
    name: Name,
  ) {
    this.server = new Signaling(server, lobby, name)

    // Bind states across classes
    this.server.ready.once(() => this.stateChange.activate(State.LOBBY))
    this.server.groupFinal.once(() => this.stateChange.activate(State.LOADING))
    this.server.close.once(this.stateChange.cancel).catch(this.stateChange.deactivate)

    // Bind Emitters
    this.join = this.server.join
    this.leave = this.server.leave
    this.propose = this.server.groupInitiate

    // Bind join's and group finalization
    this.bindSignaling()
  }

  proposeGroup(...ids: ClientID[]) {
    this.assert(State.LOBBY)
    this.server.proposeGroup(...ids)
  }

  broadcast(data: T) {
    this.assert(State.READY)
    for (const [, { send }] of this.peers)
      send(data)
  }

  private async bindSignaling() {
    const names: Map<ClientID, Name> = new Map
    this.server.join.on(({ id, name }) => names.set(id, name))
    // this.server.leave.on(id => names.delete(id))

    const allReady = [],
      { code, members } = await this.server.groupFinal.event

    // Seed RNG
    this.rng = rng(code)

    for (const [id, fns] of members) {
      const conn = new Connection(this.stuns),
        ready = new SingleEmitter

      // Save this ready promise
      allReady.push(ready.event)

      // Ready promise should resolve once connceted
      conn.statusChange
        .on(state => state == RTCState.CONNECTED && ready.activate())
        .catch(ready.deactivate)

      // Save the functions to utilze this connection
      this.peers.set(id, {
        name: names.get(id)!,
        send: (data) => conn.send(data),
        // @ts-ignore TODO fix this
        message: conn.message,
      })

      // We are an opener
      if ('createOffer' in fns && 'acceptAnswer' in fns)
        (async () => { // don't want to block entire loop on this
          fns.createOffer(await conn.createOffer())
          conn.acceptSDP(await fns.acceptAnswer)
        })()

      // We are an closer
      if ('acceptOffer' in fns && 'createAnswer' in fns)
        (async () => { // don't want to block entire loop on this
          conn.acceptSDP(await fns.acceptOffer)
          fns.createAnswer(await conn.createAnswer())
        })()
    }

    // Every connection is connected
    await Promise.all(allReady)
    this.stateChange.activate(State.READY)
    this.server.close.activate()
  }
}
