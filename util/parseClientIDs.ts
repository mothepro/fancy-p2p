
import { ClientID, Size } from '@mothepro/signaling-lobby'

/**
 * Helper to gets a list of `ClientID`s from a buffer at an offset.
 * 
 * Unfortunately, Buffer -> UInt16Array is not WAI.
 *  Also, do not rely on the underlying ArrayBuffer `data.buffer`, socket may modify it...
 */
export default function (offset: number, data: DataView): ClientID[] {
  const ids = []
  for (let i = offset; i < data.byteLength; i += Size.SHORT)
    ids.push(data.getUint16(i, true))
  return ids
}
