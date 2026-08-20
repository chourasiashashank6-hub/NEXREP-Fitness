import { useCallback, useEffect, useState } from "react";
import { getRefreshUsageCount, incrementRefreshUsageCount } from "../utils/refreshUsageCounter";

export function useRefreshUsageCount(storageKey: string | null) {
  const [count, setCount] = useState(0);

  const reload = useCallback(async () => {
    if (!storageKey) {
      setCount(0);
      return;
    }
    setCount(await getRefreshUsageCount(storageKey));
  }, [storageKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const increment = useCallback(async () => {
    if (!storageKey) return 0;
    const next = await incrementRefreshUsageCount(storageKey);
    setCount(next);
    return next;
  }, [storageKey]);

  return { count, increment, reload };
}
