import { Size, ClientID } from '@mothepro/signaling-lobby'

/** Helper to build a group proposal or rejection. */
export default function (accept: boolean, ...ids: ClientID[]) {
  const buf = new DataView(new ArrayBuffer(Size.CHAR + Size.SHORT * ids.length))
  buf.setInt8(0, +accept)
  for (let i = 0; i < ids.length; i++)
    buf.setUint16(Size.CHAR + i * Size.SHORT, ids[i], true)
  return buf.buffer
}
