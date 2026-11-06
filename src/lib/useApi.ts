"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { MemberRecord } from "@lib/pipeline/types";
import { ApiError, fetchMember, fetchQueue, type MemberResponse, type QueueResponse } from "./api";
import { useDemo } from "./demoStore";

export interface Resource<T> {
  status: "loading" | "ready" | "error";
  data: T | null;
  error: ApiError | null;
  /** True while a reload runs and the previous data is still on screen. */
  refreshing: boolean;
}

const LOADING: Resource<never> = { status: "loading", data: null, error: null, refreshing: false };

/** One in-memory cache, so pages and the header share each response. Cleared by a full page load. */
const resources = new Map<string, Resource<unknown>>();
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

let version = 0;
const notify = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function load<T>(key: string, fetcher: () => Promise<T>, force = false): Promise<void> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const current = resources.get(key) as Resource<T> | undefined;
  if (current && current.status !== "error" && !force) return Promise.resolve();

  resources.set(key, current?.data ? { ...current, refreshing: true } : LOADING);
  notify();
  const run = fetcher()
    .then((data) => {
      resources.set(key, { status: "ready", data, error: null, refreshing: false });
    })
    .catch((caught: unknown) => {
      const error = caught instanceof ApiError ? caught : new ApiError("The response could not be read.", null);
      resources.set(key, { status: "error", data: null, error, refreshing: false });
    })
    .then(() => {
      inFlight.delete(key);
      notify();
    });
  inFlight.set(key, run);
  return run;
}

function useResource<T>(key: string, fetcher: () => Promise<T>) {
  const resource = useSyncExternalStore(
    subscribe,
    () => (resources.get(key) as Resource<T> | undefined) ?? (LOADING as Resource<T>),
    () => LOADING as Resource<T>,
  );
  useEffect(() => {
    void load(key, fetcher);
  }, [key, fetcher]);
  const reload = useCallback(() => load(key, fetcher, true), [key, fetcher]);
  return { resource, reload };
}

const ready = <T,>(data: T): Resource<T> => ({ status: "ready", data, error: null, refreshing: false });

export function useQueue() {
  const { upload } = useDemo();
  const { resource, reload } = useResource("queue", fetchQueue);
  const uploaded = useMemo(() => (upload ? ready<QueueResponse>({ asOf: upload.dataset.asOf, asOfSource: upload.dataset.asOfSource, queue: upload.dataset.queue }) : null), [upload]);
  return { resource: uploaded ?? resource, reload };
}

export function useMember(id: string) {
  const { upload } = useDemo();
  const fetcher = useCallback(() => fetchMember(id), [id]);
  const { resource, reload } = useResource(`member:${id}`, fetcher);
  const uploaded = useMemo<Resource<MemberResponse> | null>(() => {
    if (!upload) return null;
    const member = upload.dataset.members.find((m) => m.id === id);
    if (!member) return { status: "error", data: null, error: new ApiError("Member not found.", 404), refreshing: false };
    return ready({ asOf: upload.dataset.asOf, member, flags: upload.dataset.flags.filter((f) => f.memberId === id), demo: upload.dataset.demo[id] ?? null });
  }, [upload, id]);
  return { resource: uploaded ?? resource, reload };
}

/** Several member records at once, sharing useMember's cache. A member appears once it has loaded. */
export function useMembers(ids: string[]): Map<string, MemberRecord> {
  const { upload } = useDemo();
  const key = ids.join("|");
  useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => {
    if (key === "") return;
    key.split("|").forEach((id) => void load(`member:${id}`, () => fetchMember(id)));
  }, [key]);
  const found = new Map<string, MemberRecord>();
  for (const id of ids) {
    const member = upload ? upload.dataset.members.find((m) => m.id === id) : (resources.get(`member:${id}`) as Resource<MemberResponse> | undefined)?.data?.member;
    if (member) found.set(id, member);
  }
  return found;
}

/** The API's asOf, which is "now" everywhere in the app. Null until the queue has loaded. */
export function useAsOf(): string | null {
  return useQueue().resource.data?.asOf ?? null;
}
