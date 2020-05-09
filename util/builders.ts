import type { LobbyID, Name, ClientID } from '@mothepro/signaling-lobby'
import { Size } from '../util/constants.js'

/* Create ArrayBuffers to send to client and server. */

const encoder = new TextEncoder

export enum MessageType {
  offer,
  answer,
  pranswer,
  rollback,
}

/** Helper to create an Intro with the server. */
export function buildIntro(lobby: LobbyID, name: Name) {
  const nameBuffer = encoder.encode(name),
    data = new DataView(new ArrayBuffer(Size.INT + nameBuffer.byteLength))
  data.setInt32(0, lobby, true)
  new Uint8Array(data.buffer, Size.INT).set(nameBuffer)
  return data.buffer
}

/** Helper to build a group proposal or rejection. */
export function buildProposal(accept: boolean, ...ids: ClientID[]) {
  const data = new DataView(new ArrayBuffer(Size.CHAR + Size.SHORT * ids.length))
  data.setInt8(0, +accept)
  for (let i = 0; i < ids.length; i++)
    data.setUint16(Size.CHAR + i * Size.SHORT, ids[i], true) 
  return data.buffer
}

/** Sends a packed SDP to the server for rerouting. */
export function buildSdp(to: ClientID, { type, sdp }: RTCSessionDescriptionInit) {
  const sdpBuffer = encoder.encode(sdp),
    data = new DataView(new ArrayBuffer(Size.SHORT + Size.CHAR + sdpBuffer.byteLength))
  data.setUint16(0, to, true)
  data.setUint8(Size.SHORT, MessageType[type!])
  new Uint8Array(data.buffer, Size.CHAR + Size.SHORT).set(sdpBuffer)
  return data.buffer
}
