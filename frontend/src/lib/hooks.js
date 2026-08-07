import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

const IDLE_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

/** Desloga automaticamente depois de X ms sem nenhuma interação do usuário. */
export function useIdleLogout(onIdle, timeoutMs = 15 * 60 * 1000, enabled = true) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(onIdle, timeoutMs);
    };

    reset();
    IDLE_EVENTS.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [onIdle, timeoutMs, enabled]);
}

export function useApiList(path, deps = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    return api.get(path)
      .then((res) => setData(res || []))
      .catch((e) => setError(e.message || "Erro ao carregar dados."))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => { reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, setData, loading, error, reload };
}

export function useToast() {
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg) => {
    setToast({ msg });
    setTimeout(() => setToast(null), 3200);
  }, []);
  return { toast, showToast };
}
