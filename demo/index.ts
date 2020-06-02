import { html, render } from 'lit-html'
import pkg from '../package.json'

import 'lit-log'
import './peer.js'

const params = new URLSearchParams(location.search),
  isProd = location.protocol == 'https:'

/** Address to the signaling server. */
export const signaling = isProd
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


// Add `lit-peer` element with the attributes if user has a name.
// The attributes will usually be hardcoded into your app.
if (params.has('name'))
  render(html`
    <lit-peer
      name=${params.get('name')!}
      retries=5
      timeout=5000
      version=0.2.0
      server=${signaling}
      lobby=${`${pkg.name}@${pkg.version}`}
      .stuns=${stuns}
    ></lit-peer>`,
    document.getElementById('main')!)
