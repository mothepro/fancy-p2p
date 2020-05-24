/** Address to the signaling server. */
export const signaling = location.protocol == 'https:'
  ? 'wss://ws.parkshade.com:443'
  : 'ws://localhost:12345'

/** List of STUN servers to broker P2P connections. */
export const stuns = location.protocol == 'https:'
  ? ['stun:stun.parkshade.com:80']
  : ['stun:stun.l.google.com:19302']
