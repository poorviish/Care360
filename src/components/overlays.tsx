"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Inbox, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SPRING, SPRING_FAST } from "@/lib/motion";

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, onClose]);
}

/** A right-hand slide-out. It floats over the page, so what is behind it does not move. */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEscape(open, onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" data-no-row>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SPRING_FAST} className="absolute inset-0 bg-navy-950/30" onClick={onClose} aria-hidden />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={SPRING}
            className="absolute top-0 right-0 bottom-0 flex w-[34rem] max-w-[94vw] flex-col bg-white border-l border-line"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">{title}</div>
              <button type="button" className="btn btn-ghost btn-sm shrink-0" aria-label="Close" onClick={onClose} autoFocus>
                <X size={17} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface PopoverPosition {
  left: number;
  top?: number;
  bottom?: number;
}

/** A click-to-open panel anchored to its trigger. In a portal, so scrolling lists cannot clip it. */
export function Popover({ label, triggerClassName, children, widthRem = 30, align = "left", block = false }: { label: ReactNode; triggerClassName: string; children: (close: () => void) => ReactNode; widthRem?: number; align?: "left" | "right"; block?: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const close = () => setPosition(null);

  const open = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
    const width = widthRem * rem;
    const wanted = align === "right" ? rect.right - width : rect.left;
    const left = Math.max(8, Math.min(wanted, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom;
    setPosition(below > 320 || below > rect.top ? { left, top: rect.bottom + 6 } : { left, bottom: window.innerHeight - rect.top + 6 });
  };

  useEscape(position !== null, close);
  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) setPosition(null);
    };
    const dismiss = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
    };
  }, [position]);

  return (
    <span ref={anchor} className={block ? "flex" : "inline-flex"}>
      <button type="button" className={triggerClassName} aria-expanded={position !== null} onClick={() => (position ? close() : open())}>
        {label}
      </button>
      {position &&
        createPortal(
          <motion.div
            ref={panel}
            role="dialog"
            data-no-row
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={SPRING_FAST}
            className="popover fixed z-50 overflow-y-auto p-4 text-foot text-navy-900"
            style={{ ...position, width: `${widthRem}rem`, maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100vh - 5rem)", transformOrigin: position.top !== undefined ? "top" : "bottom" }}
          >
            {children(close)}
          </motion.div>,
          document.body,
        )}
    </span>
  );
}

/* ---------- Fetch states ---------- */

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-xl flex-col items-center px-6 py-16 text-center">
      <AlertTriangle size={26} aria-hidden className="text-crimson" />
      <h1 className="mt-3 text-title font-semibold">{title}</h1>
      <p className="mt-1.5 text-foot text-ink-2">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-primary mt-5" onClick={onRetry}>
          <RotateCw size={15} aria-hidden />
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-16 text-center">
      <Inbox size={26} aria-hidden className="text-ink-3" />
      <h2 className="mt-3 text-title font-semibold">{title}</h2>
      <p className="mt-1.5 text-foot text-ink-2">{message}</p>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`skeleton block ${className}`} />;
}

export function LoadingBlocks({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="w-full space-y-4 px-5 pt-4 pb-10">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-96 max-w-full" />
      <div className="panel mt-6 divide-y divide-line">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="grid grid-cols-[3.5rem_repeat(3,minmax(0,1fr))] gap-6 p-5">
            <Skeleton className="h-9 w-9" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-52 max-w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-60 max-w-full" />
              <Skeleton className="h-8 w-40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
