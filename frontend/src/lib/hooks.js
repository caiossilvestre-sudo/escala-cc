import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

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
