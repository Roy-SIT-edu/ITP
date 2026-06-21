/*
 * In-memory state for one running frontend session.
 * This survives hash-tab navigation, but disappears on browser reload/app start.
 */

import { type Dispatch, type SetStateAction, useCallback, useState } from "react";

const sessionStore = new Map<string, unknown>();

export function useSessionState<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => (sessionStore.has(key) ? (sessionStore.get(key) as T) : initialValue));

  const setSessionValue = useCallback<Dispatch<SetStateAction<T>>>(
    (nextValue) => {
      setValue((previous) => {
        const resolved = typeof nextValue === "function" ? (nextValue as (current: T) => T)(previous) : nextValue;
        sessionStore.set(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, setSessionValue];
}

export function clearSessionState(...keys: string[]) {
  if (keys.length === 0) {
    sessionStore.clear();
    return;
  }
  keys.forEach((key) => sessionStore.delete(key));
}
