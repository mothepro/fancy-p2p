import { SafeSingleEmitter, SafeEmitter, Emitter, SingleEmitter, SafeListener } from 'fancy-emitter'
import Connection, { State as RTCState, Sendable } from '@mothepro/ez-rtc'
import type { Name, LobbyID } from '@mothepro/signaling-lobby'
import type { SimpleClient } from './src/Client.js'
import { Max } from './util/constants.js'
import rng from './util/random.js'
import Signaling from './src/Signaling.js'

export { default as ClientError } from './util/ClientError.js'

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

  /** Activated when the state changes, Cancels when finalized, Deactivates when error is throw. */
  readonly stateChange = new Emitter<State>(newState => this.state = newState)

  /** Shortcut to the peers being available. */
  readonly ready: SafeSingleEmitter<Set<{
    /** Name of the new peer. */
    name: Name
    /** Function to send data to activate the `message` Emitter for the peer. */
    send(data: T): void
    /** Activates when a message is received for this peer. Cancels once the connection is closed. */
    message: Emitter<T>
  }>> = new SafeSingleEmitter(() => this.stateChange.activate(State.READY))

  /** Generator for random integers that will be consistent across connections within [-2 ** 31, 2 ** 31). */
  rng?: Generator<number, never, void>

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
  readonly proposeGroup: (...members: SimpleClient[]) => void = (...members) => this.assert(State.LOBBY)
    && this.initiator.activate({ members, ack: this.server.proposeGroup(...members) })

  /** Send data to all connected peers. */
  readonly broadcast: (data: T) => void = data => this.assert(State.READY)
    && this.ready.once(peers => [...peers].map(({ send }) => send(data)))

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
      peers = new Set<{
        name: Name
        send(data: T): void
        message: SafeEmitter<T>
      }>(),
      { code, members } = await this.server.finalized.event

    // Seed RNG
    this.rng = rng(code)

    for (const client of members) {
      const conn = new Connection(this.stuns),
        message: Emitter<T> = new Emitter,
        ready = new SingleEmitter

      // Save this ready promise
      allReady.push(ready.event)

      // Ready promise should resolve once connceted
      conn.statusChange
        .on(state => {
          switch (state) {
            case RTCState.CONNECTED:
              ready.activate()
              break
            
            case RTCState.OFFLINE:
              message.cancel()
              break
          }
        })
        .catch(err => {
          ready.deactivate(err)
          message.deactivate(err)
        })

      // @ts-ignore This cast should be okay
      conn.message.on(message.activate)

      // Save the functions to utilze this connection
      peers.add({
        name: client.name,
        send: (data) => conn.send(data),
        message,
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

    // Every connection is connected successfully, ready up & close connection with server
    try {
      // TODO timeout if this takes too long
      await Promise.all(allReady)
      this.stateChange.activate(State.READY)
      this.ready.activate(peers)
      this.server.close.activate()
    } catch (err) {
      this.stateChange.deactivate(err)
    }
  }

  private async bindClose() {
    // Make sure to deactivate the `stateChange` if the server close deactivates.
    try {
      await this.server.close.event
    } catch (err) {
      this.stateChange.deactivate(err)
    }
  }
}
