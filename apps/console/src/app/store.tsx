import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { Runtime } from './runtime';
import { type RuntimeState } from './runtime';

const Ctx = createContext<Runtime | null>(null);

export function RuntimeProvider({ runtime, children }: { runtime: Runtime; children: ReactNode }) {
  return <Ctx.Provider value={runtime}>{children}</Ctx.Provider>;
}

export function useRuntime(): Runtime {
  const r = useContext(Ctx);
  if (!r) throw new Error('RuntimeProvider missing');
  return r;
}

export function useRuntimeState(): RuntimeState {
  const r = useRuntime();
  return useSyncExternalStore(r.subscribe, r.getState, r.getState);
}
