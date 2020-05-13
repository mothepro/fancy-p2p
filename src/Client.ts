import { SafeEmitter, Emitter, SafeSingleEmitter, SingleEmitter } from 'fancy-emitter'
import type { ClientID, Name } from '@mothepro/signaling-lobby'

/** Represents another client in the same lobby and signaling server as we are. */
export default class Client {
  /**
   * Activates when group is finalized.
   * Resolves with whether this connection should be an opener or closer.
   */
  // TODO doesn't need to be exposed as an emitter
  readonly isOpener: SafeSingleEmitter<boolean> = new SafeSingleEmitter

  /** Activated when this client leaves. */
  readonly disconnect = new SingleEmitter

  /** Activated when a initiating a new group. */
  readonly initiator: SafeEmitter<{
    /** The other members in this group, including me. */
    members: Client[]
    /** Function to accept or reject the group, not present if you created the group */
    action(accept: boolean): void
    /** Activated with the Client who just accepted the group proposal. Deactivates when someone rejects. */
    ack: Emitter<Client>
  }> = new SafeEmitter

  // TODO doesn't need to be exposed as an emitter
  readonly creator: SafeSingleEmitter<RTCSessionDescriptionInit> = new SafeSingleEmitter

  // TODO doesn't need to be exposed as an emitter
  readonly acceptor: SafeSingleEmitter<RTCSessionDescriptionInit> = new SafeSingleEmitter

  constructor(private readonly id: ClientID, readonly name: Name) { }
}
