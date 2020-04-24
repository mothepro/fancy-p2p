
/** Represent where we are in the process of connecting to some peers. */
export const enum State {
  /** Still attempting to connect to the server. */
  OFFLINE,

  /**
   * We are now connected to the server and lobby.
   * Waiting to make a group or join a group.
   */
  LOBBY,

  /** We have accepted a group and trying to make the RTCs. */
  LOADING,

  /** The connections with peers are set and we can now broadcast messages. */
  READY,

  /** Communication with other peers can no longer be preformed. */
  DEAD,
}
