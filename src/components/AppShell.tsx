"use client";

import { AnimatePresence, motion } from "motion/react";
import { BarChart3, Briefcase, CheckSquare, FileUp, Headset, Loader2, RotateCcw, Search, TriangleAlert, Users, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { UPLOAD } from "@lib/config/scoring";
import type { ValidationError } from "@lib/pipeline/types";
import { useElapsedMinutes } from "@/lib/clock";
import { demo, useDemo } from "@/lib/demoStore";
import { fmtShort } from "@/lib/format";
import { SPRING } from "@/lib/motion";
import { useQueue } from "@/lib/useApi";
import { Hover } from "./Hover";
import { Skeleton } from "./overlays";

const memberHref = (id: string, suffix = "") => `/member/${encodeURIComponent(id)}${suffix}`;

function NavItem({ href, icon: Icon, label, active, disabled }: { href: string; icon: LucideIcon; label: string; active: boolean; disabled?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-center text-cap font-semibold no-underline transition-colors duration-100 ${active ? "bg-[#e9e6ff] text-action" : "text-navy-800 hover:bg-navy-100"} ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <Icon size={21} aria-hidden strokeWidth={1.8} />
      <span className="leading-tight max-sm:sr-only">{label}</span>
    </Link>
  );
}

function Sidebar({ memberId, onUpload, busy }: { memberId: string | null; onUpload: () => void; busy: boolean }) {
  const pathname = usePathname();
  const { resource } = useQueue();
  const target = memberId ?? resource.data?.queue[0]?.id ?? null;
  const onMember = pathname.startsWith("/member/");
  const onEngage = onMember && pathname.endsWith("/engage");
  const footButton = "flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-center text-cap font-medium text-navy-800 hover:bg-navy-100 disabled:opacity-50";

  return (
    <aside className="flex w-[5.75rem] shrink-0 flex-col border-r border-line bg-white max-sm:w-[3.25rem]" aria-label="Main">
      <nav className="flex-1 space-y-1.5 overflow-y-auto p-2 max-sm:p-1">
        <NavItem href="/" icon={Briefcase} label="Cases" active={pathname === "/"} />
        <NavItem href={target ? memberHref(target, "?tab=care") : "/"} icon={CheckSquare} label="Tasks" active={false} disabled={!target} />
        <NavItem href={target ? memberHref(target) : "/"} icon={Users} label="Members" active={onMember && !onEngage} disabled={!target} />
        <NavItem href={target ? memberHref(target, "/engage") : "/"} icon={Headset} label="Engage" active={onEngage} disabled={!target} />
        <NavItem href="/pipeline" icon={BarChart3} label="Reports" active={pathname.startsWith("/pipeline")} />
      </nav>
      <div className="space-y-1 border-t border-line p-2 max-sm:p-1">
        <button type="button" title="Upload workbook" className={footButton} disabled={busy} onClick={onUpload}>
          {busy ? <Loader2 size={19} className="animate-spin" aria-hidden /> : <FileUp size={19} aria-hidden strokeWidth={1.8} />}
          <span className="leading-tight max-sm:sr-only">{busy ? "Processing" : "Upload"}</span>
        </button>
        <button type="button" title="Reset demo" className={footButton} onClick={() => demo.reset()}>
          <RotateCcw size={19} aria-hidden strokeWidth={1.8} />
          <span className="leading-tight max-sm:sr-only">Reset demo</span>
        </button>
      </div>
    </aside>
  );
}

/** Finds members in the API's queue, by name, member ID or trigger text. */
function MemberSearch() {
  const { resource } = useQueue();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const needle = text.trim().toLowerCase();
  const hits = needle === "" ? [] : (resource.data?.queue ?? []).filter((row) => [row.name.value, row.id, row.trigger.value].some((value) => String(value ?? "").toLowerCase().includes(needle)));
  const go = (id: string) => {
    setText("");
    setOpen(false);
    router.push(memberHref(id));
  };
  return (
    <div className="relative w-full max-w-[28rem] min-w-[10rem] max-sm:hidden">
      <Search size={16} aria-hidden className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
      <input
        type="search"
        aria-label="Search member, ID or trigger"
        placeholder="Search member, ID or trigger"
        className="field h-10 bg-surface-2 pl-9!"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) go(hits[0].id);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && needle !== "" && (
        <ul className="popover absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-y-auto p-1 text-foot">
          {hits.map((row) => (
            <li key={row.id}>
              <button type="button" className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-navy-100" onMouseDown={(e) => e.preventDefault()} onClick={() => go(row.id)}>
                <span className="font-semibold">{String(row.name.value ?? row.id)}</span> <span className="tnum text-ink-3">{row.id}</span>
                <span className="block truncate text-cap text-ink-2">{String(row.trigger.value ?? "")}</span>
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="px-2.5 py-1.5 text-ink-2">No member matches.</li>}
        </ul>
      )}
    </div>
  );
}

function AsOf() {
  const { resource } = useQueue();
  const elapsed = useElapsedMinutes();
  if (resource.status === "loading") return <Skeleton className="h-5 w-44 shrink-0" />;
  if (!resource.data) {
    return (
      <span className="flex items-center gap-1.5 text-foot whitespace-nowrap text-ink-2">
        <TriangleAlert size={15} aria-hidden className="text-crimson" />
        As-of time unavailable
      </span>
    );
  }
  return (
    <Hover
      className="tnum flex items-baseline gap-2 text-foot whitespace-nowrap"
      content={
        <>
          <p className="font-semibold">Simulated clock</p>
          <p className="mt-1">The API&apos;s as-of time is &quot;now&quot;. Countdown clocks start there and advance with elapsed browser time, one minute at a time.</p>
          <p className="mt-1 text-ink-3">Source: {resource.data.asOfSource}</p>
        </>
      }
    >
      <span className="font-semibold">As of {fmtShort(resource.data.asOf)}</span>
      {elapsed > 0 && <span className="muted">+{elapsed} min</span>}
    </Hover>
  );
}

/** The HiLabs mark: linked nodes. */
function Brand() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-1.5 text-title font-extrabold text-navy-800 no-underline">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <path d="M9 9 23 23M23 9 9 23" stroke="#4f35f5" strokeWidth="3.4" strokeLinecap="round" />
        <circle cx="9" cy="9" r="5" fill="#4f35f5" />
        <circle cx="23" cy="9" r="5" fill="#1b9be0" />
        <circle cx="9" cy="23" r="5" fill="#1b9be0" />
        <circle cx="23" cy="23" r="5" fill="#101b55" />
      </svg>
      HiLabs
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const state = useDemo();
  const pathname = usePathname();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<ValidationError[] | null>(null);

  // The Hubs keep pointing at the member last opened.
  const match = /^\/member\/([^/]+)/.exec(pathname);
  const pathMember = match ? decodeURIComponent(match[1]).toUpperCase() : null;
  const [lastMember, setLastMember] = useState<string | null>(pathMember);
  if (pathMember && pathMember !== lastMember) setLastMember(pathMember);

  const onFile = async (file: File) => {
    setErrors(null);
    if (file.size > UPLOAD.maxBytes) {
      setErrors([{ sheet: null, message: `That file is larger than the ${UPLOAD.maxBytes / (1024 * 1024)} MB limit. Choose a smaller workbook.` }]);
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/process", { method: "POST", body });
      const json = await response.json();
      if (json.ok) {
        demo.setUpload({ dataset: json.dataset, report: json.report, fileName: file.name });
        router.push("/");
      } else {
        setErrors(json.errors);
      }
    } catch {
      setErrors([{ sheet: null, message: "The upload did not reach the server. Check the connection and try again." }]);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="z-30 flex h-[3.75rem] shrink-0 items-center gap-4 border-b border-line bg-white px-4">
        <Brand />
        <span aria-hidden className="h-6 w-px bg-line max-md:hidden" />
        <span className="truncate text-head font-bold text-navy-800 max-md:hidden">Case Management Workbench</span>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-4">
          <MemberSearch />
          <AsOf />
        </div>
      </header>
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        aria-label="Upload workbook"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar memberId={lastMember} busy={busy} onUpload={() => input.current?.click()} />
        <div className="relative flex min-w-0 flex-1 flex-col">
          {state.upload && (
            <div role="status" className="flex shrink-0 items-center justify-center gap-1.5 border-b border-line bg-action-tint py-1.5 text-cap text-ink-2">
              <FileUp size={13} aria-hidden />
              Showing uploaded workbook <strong className="font-semibold">{state.upload.fileName}</strong> for this session. Nothing was stored on the server.
            </div>
          )}
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>

          <AnimatePresence>
            {errors && (
              <motion.div role="alert" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={SPRING} className="sheet absolute top-3 right-5 z-40 flex w-[30rem] max-w-[calc(100%-2.5rem)] items-start gap-3 p-4 text-foot">
                <TriangleAlert size={18} aria-hidden className="mt-0.5 shrink-0 text-crimson" />
                <div className="min-w-0">
                  <p className="font-semibold">The workbook was not loaded. The current data is unchanged.</p>
                  <ul className="mt-1.5 space-y-0.5 text-ink-2">
                    {errors.slice(0, 5).map((error) => (
                      <li key={`${error.sheet ?? ""}-${error.message}`}>
                        {error.sheet ? `${error.sheet}: ` : ""}
                        {error.message}
                      </li>
                    ))}
                    {errors.length > 5 && <li>and {errors.length - 5} more problems</li>}
                  </ul>
                </div>
                <button type="button" className="btn btn-ghost btn-sm ml-auto shrink-0" aria-label="Dismiss upload errors" onClick={() => setErrors(null)}>
                  <X size={15} aria-hidden />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
