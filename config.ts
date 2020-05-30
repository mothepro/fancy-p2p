/** Address to the signaling server. */
export const signaling = location.protocol == 'https:'
  ? 'wss://ws.parkshade.com:443'
  : 'ws://localhost:12345'

/** List of STUN servers to broker P2P connections. */
export const stuns = [
  "stun:stun.stunprotocol.org", // http://www.stunprotocol.org/
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun2.l.google.com:19302",
  "stun:stun3.l.google.com:19302",
  "stun:stun4.l.google.com:19302",
]
