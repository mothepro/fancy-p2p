import { Max } from './constants.js'

/**
 * Yields a random integer using Multiply with carry PRNG within [-2 ** 31, 2 ** 31).
 * https://en.wikipedia.org/wiki/Multiply-with-carry_pseudorandom_number_generator
 */
export default function* (seed: number): Generator<number, never, void> {
  let multiplier = 987654321

  while (true) {
    multiplier = (36969 * (multiplier & Max.SHORT) + (multiplier >> 16)) & Max.INT
    seed = (18000 * (seed & Max.SHORT) + (seed >> 16)) & Max.INT
    yield ((multiplier << 16) + seed) & Max.INT
  }
}
