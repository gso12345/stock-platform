/**
 * 관심종목에 담기 — 종목 상세처럼 담을 폴더를 고른다.
 *
 * 사용자: "관심종목 어떤 폴더에 담을지 종목상세탭처럼 해줘". 스크리닝 표의 별은 누르면 곧바로
 * 기본 목록에 담았고, 이미 담긴 종목도 빈 별이라 누르면 '이미 추가된 종목' 오류가 떴다.
 *   · 빈 별을 누르면 폴더 목록(기본 + 내 폴더)이 펼쳐지고, 고른 폴더에 담는다
 *   · 이미 담긴 종목은 채운 별 — 누르면 뺀다(종목 상세의 단추와 같다)
 * 폴더 목록은 종목 상세와 같은 부품(관심폴더메뉴)이다.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Star } from "lucide-react";
import { watchlistApi, watchlistFolderApi } from "@/api/stocks";
import { use관심목록 } from "@/hooks/useWatchlistItems";
import { 읽을수있는오류 } from "@/utils/errors";
import { cn } from "@/components/ui";
import type { Market, 관심폴더 } from "@/types";

/** 폴더를 안 고르고 담으면 서버가 이 이름의 폴더에 넣는다(routes/watchlist._ensure_default_folder) */
const 기본폴더이름 = "기본 관심목록";

/** 담을 폴더 고르기 — 종목 상세의 '추가' 와 표의 별이 같은 목록을 쓴다.
 *  예전엔 맨 위에 '기본 (폴더 없음)' 을 두고 그 아래 폴더들을 늘어놨는데, 폴더 없이 담은 종목은
 *  서버가 '기본 관심목록' 폴더에 넣으므로 그 폴더가 있으면 같은 곳이 이름만 다르게 두 번 보였다.
 *  기본은 관심종목 화면과 같은 이름으로 맨 위에 한 번만 둔다. */
export function 관심폴더메뉴({ 폴더들, 고르기 }: {
  폴더들: 관심폴더[];
  고르기: (폴더: number | null) => void;
}) {
  const 기본 = 폴더들.find((f) => f.name === 기본폴더이름);
  const 나머지 = 폴더들.filter((f) => f !== 기본);
  return (
    <div role="menu" aria-label="담을 폴더"
      className="w-44 max-h-80 overflow-y-auto rounded-xl border border-border bg-bg-card shadow-float">
      <button type="button" role="menuitem" onClick={() => 고르기(기본?.id ?? null)}
        className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-elevated transition-colors">
        {기본폴더이름}
      </button>
      {나머지.map((f) => (
        <button key={f.id} type="button" role="menuitem" onClick={() => 고르기(f.id)}
          className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-elevated transition-colors border-t border-border truncate">
          {f.name}
        </button>
      ))}
    </div>
  );
}

const 메뉴너비 = 176;   // w-44
const 메뉴한줄 = 37;     // py-2 text-sm 한 줄

/** 표 줄의 별 — 빈 별은 폴더를 골라 담고, 채운 별은 뺀다 */
export function 관심별({ symbol, market, name, 로그인함, 알리기 }: {
  symbol: string;
  market: string;
  name: string;
  로그인함: boolean;
  /** 담았다·뺐다·못 했다를 화면의 알림으로 */
  알리기: (글: string, 종류: "success" | "error") => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: 목록 } = use관심목록(로그인함);
  const 담긴것 = 로그인함 ? (목록 ?? []).find((i) => i.symbol === symbol) : undefined;
  const { data: 폴더들 = [] } = useQuery({
    queryKey: ["watchlist-folders"],
    queryFn: () => watchlistFolderApi.getFolders(),
    enabled: 로그인함,
    staleTime: 600_000,
  });
  /* 누르자마자 채우고 비운다 — 서버가 답할 때까지 그대로면 안 눌린 줄 알고 또 누른다
     (같은 종목이 두 줄 된다). 목록이 새로 오면 목록을 따른다 */
  const [잠깐, set잠깐] = useState<boolean | null>(null);
  useEffect(() => set잠깐(null), [담긴것?.id]);
  const 채움 = 잠깐 ?? !!담긴것;
  const [자리, set자리] = useState<{ top: number; left: number } | null>(null);
  const 단추 = useRef<HTMLButtonElement>(null);
  const 메뉴 = useRef<HTMLDivElement>(null);

  const 새로 = () => {
    qc.invalidateQueries({ queryKey: ["watchlist-items"] });
    qc.invalidateQueries({ queryKey: ["watchlist-items-check"] });
  };
  const 담기 = useMutation({
    mutationFn: (folderId: number | null) => watchlistApi.addItem({
      symbol, market: market as Market, name, watchlist_id: 1, folder_id: folderId,
    }),
    onSuccess: () => { 새로(); 알리기(`${name} 관심종목에 담았어요`, "success"); },
    onError: (err: any) => {
      set잠깐(null);
      if (err?.response?.status === 401) { navigate("/login"); return; }
      const 글 = 읽을수있는오류(err?.response?.data?.detail, "담지 못했어요");
      if (글.includes("이미")) { 새로(); 알리기("이미 담긴 종목이에요", "success"); return; }
      알리기(글, "error");
    },
  });
  const 빼기 = useMutation({
    mutationFn: (id: number) => watchlistApi.removeItem(id),
    onSuccess: () => { 새로(); 알리기(`${name} 관심종목에서 뺐어요`, "success"); },
    onError: () => { set잠깐(null); 알리기("빼지 못했어요", "error"); },
  });

  /* 표는 가로로 미는 상자 안이라, 그 안에 띄우면 잘린다 — 화면 좌표로 띄운다(아래가 좁으면 위로) */
  const 열기 = () => {
    const r = 단추.current?.getBoundingClientRect();
    if (!r) return;
    const 높이 = Math.min(메뉴한줄 * (폴더들.length + 1) + 2, 320);
    const left = Math.max(8, Math.min(r.right - 메뉴너비, window.innerWidth - 메뉴너비 - 8));
    const top = window.innerHeight - r.bottom < 높이 + 16 ? Math.max(8, r.top - 높이 - 4) : r.bottom + 4;
    set자리({ top, left });
  };

  useEffect(() => {
    if (!자리) return;
    const 바깥 = (e: MouseEvent) => {
      const 곳 = e.target as Node;
      if (메뉴.current?.contains(곳) || 단추.current?.contains(곳)) return;
      set자리(null);
    };
    const 키 = (e: KeyboardEvent) => {
      if (e.key === "Escape") { set자리(null); 단추.current?.focus(); }
    };
    // 화면 좌표로 띄웠으니 밀리면 자리가 어긋난다 — 닫는다
    const 밀림 = (e: Event) => { if (!메뉴.current?.contains(e.target as Node)) set자리(null); };
    document.addEventListener("mousedown", 바깥);
    window.addEventListener("keydown", 키);
    window.addEventListener("scroll", 밀림, true);
    window.addEventListener("resize", 밀림);
    return () => {
      document.removeEventListener("mousedown", 바깥);
      window.removeEventListener("keydown", 키);
      window.removeEventListener("scroll", 밀림, true);
      window.removeEventListener("resize", 밀림);
    };
  }, [자리]);

  const 누름 = () => {
    if (!로그인함) { navigate("/login"); return; }
    if (채움) {
      if (담긴것) { set잠깐(false); 빼기.mutate(담긴것.id); }
      return;
    }
    if (자리) set자리(null); else 열기();
  };

  return (
    <>
      <button ref={단추} type="button" onClick={누름} disabled={담기.isPending || 빼기.isPending}
        aria-label={채움 ? `${name} 관심종목에서 빼기` : `${name} 관심종목에 담기`}
        aria-pressed={채움}
        aria-haspopup={채움 ? undefined : "menu"}
        aria-expanded={채움 ? undefined : !!자리}
        className={cn("p-1 rounded transition-colors",
          채움 ? "text-accent-yellow hover:text-accent-red" : "text-text-muted hover:text-accent-yellow")}>
        <Star size={13} fill={채움 ? "currentColor" : "none"} />
      </button>
      {자리 && (
        <div ref={메뉴} className="fixed z-50" style={{ top: 자리.top, left: 자리.left }}>
          <관심폴더메뉴 폴더들={폴더들} 고르기={(폴더) => { set자리(null); set잠깐(true); 담기.mutate(폴더); }} />
        </div>
      )}
    </>
  );
}
