export type { SimpleClient as Client } from './src/Client.js'
export type { MySimplePeer as Peer, MockPeer, Sendable } from './src/Peer.js'
export { default, State } from './src/P2P.js'

import type SimplePeer from 'simple-peer'
import 'simple-peer'

// @ts-ignore simple-peer doesn't support ESM
export const ENABLED = SimplePeer.WEBRTC_SUPPORT
