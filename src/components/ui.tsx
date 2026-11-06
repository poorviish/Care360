"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { SPRING } from "@/lib/motion";

/** Height spring for anything that opens in place. Reversing mid-flight continues from where it is. */
export function Expand({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING} className={`overflow-hidden ${className ?? ""}`}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-foot font-medium">
      <span className="switch">
        <input type="checkbox" role="switch" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track" />
        <span className="switch-knob" />
      </span>
      <span>{label}</span>
    </label>
  );
}
