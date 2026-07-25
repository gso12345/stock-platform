import { useState, useEffect, useRef } from "react";
import api from "@/api/client";

export interface SearchResult {
  symbol: string; name: string; market: string; type: string; exchange: string;
}

/**
 * 종목 검색 — 내 자산·관심종목 추가 모달이 각자 구현하던 디바운스 검색을 하나로 모았다.
 * 한글 입력은 조합이 끝난 뒤에 검색되도록 디바운스를 넉넉히 둔다.
 */
export function useStockSearch(delay = 300) {
  const [query, setQuery]         = useState("");
  const [results, setResults]     = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.get<{ results: SearchResult[] }>("/search", { params: { q: query } });
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, delay]);

  return { query, setQuery, results, searching };
}
