import type { ClientID } from '@mothepro/signaling-lobby'
import { Size, Code } from '../util/constants.js'
import { MessageType } from './builders.js'

/* Parse ArrayBuffers to sent from server to us. */

const decoder = new TextDecoder

/**
 * Helper to gets a list of `ClientID`s from a buffer at an offset.
 * 
 * Unfortunately, Buffer -> UInt16Array is not WAI.
 *  Also, do not rely on the underlying ArrayBuffer `data.buffer`, socket may modify it...
 */
export function parseClientIds(offset: number, data: DataView): ClientID[] {
  const ids = []
  for (let i = offset; i < data.byteLength; i += Size.SHORT)
    ids.push(data.getUint16(i, true))
  return ids
}

/** Helper to get status of a Client joining. */
export function parseClientJoin(data: DataView) {
  if (data.getUint8(0) == Code.CLIENT_JOIN
    && data.byteLength > Size.CHAR + Size.SHORT)
    return {
      id: data.getUint16(Size.CHAR, true),
      name: decoder.decode(data.buffer.slice(Size.CHAR + Size.SHORT)),
    }

  throw Error(`Expected a client join message, but got ${data}`)
}

/** Helper to get status of a Client leaving. */
export function parseClientLeave(data: DataView) {
  if (data.getUint8(0) == Code.CLIENT_LEAVE
    && data.byteLength == Size.CHAR + Size.SHORT)
    return data.getUint16(Size.CHAR, true)

  throw Error(`Expected a client leave message, but got ${data}`)
}

/** Helper to get status of a Client leaving. */
export function parseGroupChange(data: DataView) {
  if ((data.getUint8(0) == Code.GROUP_REJECT || data.getUint8(0) == Code.GROUP_REQUEST)
    && data.byteLength >= Size.CHAR + Size.SHORT
    && data.byteLength % Size.SHORT == Size.CHAR)
    return {
      approve: data.getUint8(0) == Code.GROUP_REQUEST,
      actor: data.getUint16(Size.CHAR, true),
      members: parseClientIds(Size.CHAR, data),
    }

  throw Error(`Expected a group join or leave message, but got ${data}`)
}


/** Helper to get status of a Group finalization. */
export function parseGroupFinalize(data: DataView) {
  if (data.getUint8(0) == Code.GROUP_FINAL
    && data.byteLength >= Size.CHAR + Size.INT)
    return {
      code: data.getInt32(Size.CHAR, true),
      cmp: data.getUint16(Size.CHAR + Size.INT, true),
      members: parseClientIds(Size.CHAR + Size.INT + Size.SHORT, data),
    }

  throw Error(`Expected a group finalize message, but got ${data}`)
}

export function parseSdp(data: DataView) {
  if (data.byteLength > Size.SHORT + Size.CHAR
    && data.getUint8(Size.CHAR) in MessageType)
    return {
      from: data.getUint16(0, true),
      sdp: {
        type: MessageType[data.getUint8(Size.SHORT)] as RTCSdpType,
        sdp: decoder.decode(data.buffer.slice(Size.SHORT + Size.CHAR)),
      }
    }

  throw Error(`Expected a SDP message, but got ${data}`)
}
