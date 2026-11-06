"use client";

import { motion } from "motion/react";
import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SPRING_FAST } from "@/lib/motion";

interface Position {
  left: number;
  top?: number;
  bottom?: number;
}

const WIDTH = 320;
const GAP = 8;

/**
 * Hover and keyboard-focus detail, in a portal so scrolling panes cannot clip it. It grows out of
 * the value it describes. It enhances that value and never holds the only copy of it.
 */
export function Hover({ content, children, className, focusable = true }: { content: ReactNode; children: ReactNode; className?: string; focusable?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const id = useId();

  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));
    const roomBelow = window.innerHeight - rect.bottom;
    setPosition(roomBelow > 200 ? { left, top: rect.bottom + GAP } : { left, bottom: window.innerHeight - rect.top + GAP });
  };
  const hide = () => setPosition(null);

  return (
    <span
      ref={ref}
      className={className}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={position ? id : undefined}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {position &&
        createPortal(
          <motion.div
            id={id}
            role="tooltip"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={SPRING_FAST}
            className="popover pointer-events-none fixed z-50 px-3 py-2.5 text-cap text-navy-900"
            style={{ ...position, width: WIDTH, transformOrigin: position.top !== undefined ? "top left" : "bottom left" }}
          >
            {content}
          </motion.div>,
          document.body,
        )}
    </span>
  );
}
