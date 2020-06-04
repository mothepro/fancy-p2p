import { SafeEmitter, SafeListener, Emitter, SafeSingleEmitter } from 'fancy-emitter'
import type { ClientID, Name } from '@mothepro/signaling-lobby'

/** Represents another client in the same lobby and signaling server as we are. */
export interface SimpleClient {
  /** Name of this client. */
  readonly name: Name
  /** Activated when a initiating a new group. */
  readonly initiator: SafeListener<{
    /** The other members in this group, including me. */
    members: SimpleClient[]
    /** Function to accept or reject the group, not present if you created the group */
    action?(accept: boolean): void
    /** Activated with the Client who just accepted the group proposal. Deactivates when someone rejects. */
    ack: Emitter<SimpleClient>
  }>
  /**
   * Whether this client represents you in the lobby.
   * When false this is another peer and data is sent through the wire.
   */
  readonly isYou: boolean
}

export class MockClient implements SimpleClient {
  readonly isYou = true
  readonly initiator: Emitter<{
    members: SimpleClient[]
    ack: Emitter<SimpleClient>
  }> = new Emitter
  constructor(readonly name: Name) { }
}

/** Represents another client in the same lobby and signaling server as we are that can preform SDP exchange. */
export default class implements SimpleClient {
  readonly isYou = false

  readonly initiator: Emitter<{
    members: SimpleClient[]
    action(accept: boolean): void
    ack: Emitter<SimpleClient>
  }> = new Emitter

  /**
   * Activates when group is finalized.
   * Resolves with whether this connection should be an opener or closer.
   */
  // TODO doesn't need to be exposed as an emitter
  readonly isOpener: SafeSingleEmitter<boolean> = new SafeSingleEmitter

  /** Activate with the creation of an SDP to send it to the corresponding client. */
  readonly creator: SafeEmitter<RTCSessionDescriptionInit> = new SafeEmitter

  /** Activates when an SDP is received for this corresponding client. */
  readonly acceptor: SafeEmitter<RTCSessionDescriptionInit> = new SafeEmitter

  constructor(readonly id: ClientID, readonly name: Name) { }
}
