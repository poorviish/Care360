"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** With reduced motion on, springs that move things become cross-fades. */
export function Providers({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
