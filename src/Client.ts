import { SafeEmitter, SafeListener, Emitter, SafeSingleEmitter, SingleEmitter } from 'fancy-emitter'
import type { ClientID, Name } from '@mothepro/signaling-lobby'

/** Represents another client in the same lobby and signaling server as we are. */
export interface SimpleClient {
  /** Name of this client. */
  readonly name: Name

  /** Activated when this client leaves. */
  readonly disconnect: SingleEmitter

  /** Activated when a initiating a new group. */
  readonly initiator: SafeListener<{
    /** The other members in this group, including me. */
    members: SimpleClient[]
    /** Function to accept or reject the group, not present if you created the group */
    action(accept: boolean): void
    /** Activated with the Client who just accepted the group proposal. Deactivates when someone rejects. */
    ack: Emitter<SimpleClient>
  }>
}

/** Represents another client in the same lobby and signaling server as we are that can preform SDP exchange. */
export default class implements SimpleClient {
  readonly disconnect = new SingleEmitter

  readonly initiator: SafeEmitter<{
    members: SimpleClient[]
    action(accept: boolean): void
    ack: Emitter<SimpleClient>
  }> = new SafeEmitter

  /**
   * Activates when group is finalized.
   * Resolves with whether this connection should be an opener or closer.
   */
  // TODO doesn't need to be exposed as an emitter
  readonly isOpener: SafeSingleEmitter<boolean> = new SafeSingleEmitter

  /** Activate with the creation of an SDP to send it to the corresponding client. */
  // TODO doesn't need to be exposed as an emitter
  readonly creator: SafeEmitter<RTCSessionDescriptionInit> = new SafeEmitter

  /** Activates when an SDP is received for this corresponding client. */
  // TODO doesn't need to be exposed as an emitter
  readonly acceptor: SafeEmitter<RTCSessionDescriptionInit> = new SafeEmitter

  constructor(private readonly id: ClientID, readonly name: Name) { }
}
