/**
 * Motion vocabulary. Springs take Apple's two parameters: bounce (from the damping ratio) and
 * visualDuration (the response, in seconds). They start from the live value and carry velocity,
 * so any animation can be interrupted and reversed.
 */

/** The default: critically damped, no overshoot. */
export const SPRING = { type: "spring", visualDuration: 0.36, bounce: 0 } as const;

/** Small things: chips, thumbs and popovers. */
export const SPRING_FAST = { type: "spring", visualDuration: 0.24, bounce: 0 } as const;

/** Bounce is earned: only when a gesture carried momentum into the motion. */
export const SPRING_MOMENTUM = { type: "spring", visualDuration: 0.34, bounce: 0.2 } as const;

/** Apple's decay projection: where a flick would come to rest, in the same units as the velocity. */
export function project(velocityPerSecond: number, decelerationRate = 0.99) {
  return ((velocityPerSecond / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Soft boundary: the further past the limit, the less the element follows. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
