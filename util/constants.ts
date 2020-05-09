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
 * The different types of messages that the Signaling server can give to a browser.
 * https://github.com/mothepro/signaling-lobby/blob/7812e90996ef18ac5bedf814ca5a6a261ebf9966/src/messages.ts#L86
 * 
 * const enums suck across modules 😭 (and `import type` doesn't help).
 */
export const enum Code {
  CLIENT_LEAVE,
  CLIENT_JOIN,
  GROUP_REQUEST,
  GROUP_REJECT,
  GROUP_FINAL,
}
