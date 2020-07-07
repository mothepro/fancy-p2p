/** Number of bytes that a data type takes up. */
export const enum Size {
  CHAR = 1 << 0,
  SHORT = 1 << 1,
  INT = 1 << 2,
  BIG = 1 << 3,
}

/** Number of bits that a data type takes up. */
const enum SizeBits {
  CHAR = Size.CHAR << 3,
  SHORT = Size.SHORT << 3,
  INT = Size.INT << 3,
  BIG = Size.BIG << 3,
}

/** Max value that can fit in a data type. */
export const enum Max {
  CHAR = 2 ** SizeBits.CHAR - 1,
  SHORT = 2 ** SizeBits.SHORT - 1,
  INT = 2 ** SizeBits.INT - 1,
  BIG = 2 ** SizeBits.BIG - 1,
}

/**
 * Prefix to buffer sent from server to the clients.
 * Should exactly match `Code` enum in https://github.com/mothepro/signaling-lobby/blob/master/util/constants.ts
 */
export const enum Code {
  CLIENT_LEAVE = 0,
  CLIENT_JOIN = 1,
  GROUP_REQUEST = 2,
  GROUP_REJECT = 3,
  GROUP_FINAL = 4,
  YOUR_NAME = 5
}
