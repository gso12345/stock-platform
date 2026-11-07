/**
 * 대화방 — 1:1 메시지(사용자: "상대방이랑 채팅도 할 수 있도록 해줘").
 *
 *   · 말풍선 — 내 것은 오른쪽 파랑, 상대 것은 왼쪽(묶음 첫 줄에 아바타). 같은 사람이 같은 분에 연달아 보낸 것은
 *     묶어서 시각은 끝에만. 날이 바뀌면 가운데 날짜 줄. 상대가 읽은 내 마지막 메시지 아래에 '읽음'
 *   · 입력칸은 화면 아래 — 휴대폰은 아래 탭을 숨기고 그 자리에, 자판이 올라오면 자판 바로 위(글 상세의 댓글칸과 같다)
 *     PC 는 Enter 로 보내고 Shift+Enter 로 줄을 바꾼다. 휴대폰 자판의 Enter 는 줄바꿈 — 보내기는 단추로.
 *     한글을 조합하는 중의 Enter 는 글자를 끝내는 것이라 보내지 않는다(안 그러면 마지막 글자가 한 번 더 간다)
 *   · 보내면 바로 말풍선을 그리고(보내는 중) 서버가 받으면 시각을 단다. 못 보내면 '못 보냄' — 눌러서 다시 보내기
 *   · 새 메시지는 화면이 보이는 동안 묻는다 — 오가는 중이면 3초, 조용하면 차츰 10초까지. 30초마다 최근 것을 통째로
 *     다시 받아 상대가 지운 것·가려진 것도 열린 화면에 반영한다. 메시지 푸시가 오면 바로 묻는다
 *   · 바닥에 붙어 있으면 새 메시지를 따라 내려가고, 위로 올려 보던 중이면 '새 메시지 ↓' 만 띄운다
 *   · 맨 위로 올리면 이전 메시지를 더 받고, 보던 자리를 지킨다
 *   · 말풍선을 누르면 복사 · 삭제(내 것) · 신고(받은 것). 위 ⋯ 에 프로필 · 차단 · 나가기
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown, ArrowLeft, Ban, Copy, Flag, LogIn, LogOut, MessageCircle, RotateCw, Send, Trash2, User, UserX,
  type LucideIcon,
} from "lucide-react";
import { dmApi, dm열쇠, type 대화방줄, type 대화상대 } from "@/api/dm";
import { useAuthStore } from "@/store/authStore";
import Avatar from "@/components/community/Avatar";
import 글메뉴, { type 메뉴항목 } from "@/components/community/글메뉴";
import 신고창, { 신고보내기 } from "@/components/community/신고창";
import { DM_MAX } from "@/constants/community";
import { use확인, use알림 } from "@/hooks/useDialogs";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { use자판높이 } from "@/hooks/useSheet";
import { use메시지푸시, 대화알림닫기 } from "@/hooks/useDmPush";
import { 빈화면, 못불러옴, cn } from "@/components/ui";
import {
  대화줄들, 메시지합치기, 바뀐것있나, 말풍선시각, type 대화줄, type 표시메시지,
} from "@/utils/대화시각";

/** 새 메시지를 묻는 간격 — 오가는 중이면 자주, 조용하면 차츰 늘린다. 실패하면 더 늘린다 */
export const 묻기간격 = { 처음: 3_000, 최대: 10_000, 실패최대: 30_000 } as const;
/** 이만큼마다 최근 것을 통째로 다시 받는다 — 상대가 지운 것·가려진 것을 열린 화면에도 */
export const 다시받기간격 = 30_000;
/** 바닥에서 이만큼 안이면 '바닥에 붙어 있다' — 새 메시지가 오면 따라 내려간다 */
const 바닥여유 = 80;

type 그림할일 = { 종류: "바닥" } | { 종류: "추가" } | { 종류: "보정"; 높이: number; 위치: number };

export default function ChatRoom() {
  const { threadId } = useParams<{ threadId: string }>();
  // 방을 옮기면 처음부터 — 앞 방의 메시지·번호가 남지 않게
  return <대화방화면 key={threadId} 방번호={Number(threadId)} />;
}

function 상태코드(e: unknown): number | undefined {
  return (e as { response?: { status?: number } } | null)?.response?.status;
}

function 작은단추({ 아이콘, 위험, onClick, children }: {
  아이콘: LucideIcon; 위험?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn("flex items-center gap-1 px-2.5 py-1 rounded-full border text-2xs font-semibold transition-colors",
        위험 ? "border-accent-red/30 text-accent-red hover:bg-accent-red/10"
             : "border-border text-text-secondary hover:border-accent-blue/40 hover:text-accent-blue")}>
      <아이콘 size={11} /> {children}
    </button>
  );
}

function 대화방화면({ 방번호 }: { 방번호: number }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const 넓음 = use넓은화면();
  const 자판 = use자판높이(!넓음);
  const { 묻기: 확인묻기, 화면: 확인화면 } = use확인();
  const { 보이기, 화면: 알림화면 } = use알림();
  const 옳은번호 = Number.isInteger(방번호) && 방번호 > 0;

  const 방질의 = useQuery({
    queryKey: dm열쇠.방(방번호),
    queryFn: () => dmApi.getThread(방번호),
    enabled: isLoggedIn && 옳은번호,
    staleTime: 30_000,
  });
  const 방 = 방질의.data;
  const 상대: 대화상대 | undefined = 방?.other;

  const [메시지들, set메시지들] = useState<표시메시지[]>([]);
  const [더있음, set더있음] = useState(false);
  const [상대읽음, set상대읽음] = useState(0);
  const [처음, set처음] = useState<"받는중" | "됨" | "실패">("받는중");
  const [처음오류, set처음오류] = useState<unknown>(null);
  const [다시시도, set다시시도] = useState(0);
  const [이전받는중, set이전받는중] = useState(false);
  const [입력, set입력] = useState("");
  const [고른것, set고른것] = useState<string | null>(null);
  const [신고할, set신고할] = useState<표시메시지 | null>(null);
  const [새것있음, set새것있음] = useState(false);

  const 틀 = useRef<HTMLDivElement>(null);
  const 입력칸 = useRef<HTMLTextAreaElement>(null);
  const 위끝 = useRef<HTMLButtonElement>(null);
  /** 서버에서 받은 가장 큰 번호 — '이 다음 것' 을 묻는다. 내가 보낸 것으로는 올리지 않는다(그 사이 상대 것을 건너뛴다) */
  const 마지막번호 = useRef(0);
  const 간격 = useRef<number>(묻기간격.처음);
  const 묻는중 = useRef(false);
  const 이전받는참 = useRef(false);
  const 마지막전체 = useRef(Date.now());
  const 읽음보냄 = useRef(0);
  const 바닥붙음 = useRef(true);
  const 할일 = useRef<그림할일 | null>(null);
  const 임시순번 = useRef(0);
  const 메시지참조 = useRef<표시메시지[]>([]);
  메시지참조.current = 메시지들;

  // ── 스크롤 — 본문(Layout 의 main)이 스크롤한다 ─────────────
  const 스크롤러 = useCallback((): HTMLElement | null =>
    (틀.current?.closest("main") as HTMLElement | null) ?? (document.scrollingElement as HTMLElement | null), []);

  const 바닥으로 = useCallback((부드럽게 = false) => {
    const el = 스크롤러();
    if (!el) return;
    try {
      el.scrollTo({ top: el.scrollHeight, behavior: 부드럽게 ? "smooth" : "auto" });
    } catch {
      el.scrollTop = el.scrollHeight;
    }
    바닥붙음.current = true;
    set새것있음(false);
  }, [스크롤러]);

  useEffect(() => {
    const el = 스크롤러();
    if (!el) return;
    const 볼때 = () => {
      바닥붙음.current = el.scrollHeight - el.scrollTop - el.clientHeight < 바닥여유;
      if (바닥붙음.current) set새것있음(false);
    };
    el.addEventListener("scroll", 볼때, { passive: true });
    return () => el.removeEventListener("scroll", 볼때);
  }, [스크롤러]);

  /* 그린 직후 — 처음이면 바닥으로, 이전 것을 위에 붙였으면 보던 자리 그대로, 새 것이 왔으면 따라가거나 알리기 */
  useLayoutEffect(() => {
    const 이번 = 할일.current;
    할일.current = null;
    if (!이번) return;
    const el = 스크롤러();
    if (!el) return;
    if (이번.종류 === "바닥") 바닥으로(false);
    else if (이번.종류 === "보정") el.scrollTop = 이번.위치 + (el.scrollHeight - 이번.높이);
    else if (바닥붙음.current) 바닥으로(true);
    else set새것있음(true);
  }, [메시지들, 스크롤러, 바닥으로]);

  // ── 처음 받기 ─────────────────────────────────────────────
  useEffect(() => {
    if (!isLoggedIn || !옳은번호) return;
    let 끝 = false;
    set처음("받는중");
    dmApi.getMessages(방번호).then((r) => {
      if (끝) return;
      할일.current = { 종류: "바닥" };
      set메시지들(r.items);
      set더있음(r.has_more);
      set상대읽음(r.other_read_id);
      마지막번호.current = r.items.length ? r.items[r.items.length - 1].id : 0;
      마지막전체.current = Date.now();
      set처음("됨");
    }).catch((e) => {
      if (끝) return;
      set처음오류(e);
      set처음("실패");
    });
    return () => { 끝 = true; };
  }, [방번호, isLoggedIn, 옳은번호, 다시시도]);

  // ── 새 것 묻기 ────────────────────────────────────────────
  const 새로묻기 = useCallback(async () => {
    if (묻는중.current) return;
    묻는중.current = true;
    try {
      let 받은수 = 0;
      if (Date.now() - 마지막전체.current >= 다시받기간격) {
        /* 최근 것을 통째로 — 이미 받은 번호까지만 합친다. 새 번호는 아래 '다음 것' 이 차례대로 받는다
           (여기서 번호를 올리면, 30개보다 많이 쌓였을 때 그 사이를 건너뛴다) */
        const r = await dmApi.getMessages(방번호);
        마지막전체.current = Date.now();
        set상대읽음(r.other_read_id);
        const 받은것 = r.items.filter((m) => m.id <= 마지막번호.current);
        if (바뀐것있나(메시지참조.current, 받은것)) set메시지들((v) => 메시지합치기(v, 받은것));
      }
      for (let 번 = 0; 번 < 5; 번++) {
        const r = await dmApi.getMessages(방번호, { after_id: 마지막번호.current });
        set상대읽음(r.other_read_id);
        if (r.items.length) {
          마지막번호.current = r.items[r.items.length - 1].id;
          if (바뀐것있나(메시지참조.current, r.items)) {
            받은수 += r.items.length;
            할일.current = { 종류: "추가" };
            set메시지들((v) => 메시지합치기(v, r.items));
          }
        }
        if (!r.has_more) break;
      }
      간격.current = 받은수 > 0 ? 묻기간격.처음 : Math.min(Math.round(간격.current * 1.5), 묻기간격.최대);
    } catch {
      간격.current = Math.min(간격.current * 2, 묻기간격.실패최대);
    } finally {
      묻는중.current = false;
    }
  }, [방번호]);

  // ── 읽음 ──────────────────────────────────────────────────
  const 읽음알리기 = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    let 상대최신 = 0;
    let 끝번호 = 0;
    for (const m of 메시지참조.current) {
      if (m.id <= 0) continue;
      끝번호 = Math.max(끝번호, m.id);
      if (!m.mine) 상대최신 = Math.max(상대최신, m.id);
    }
    if (상대최신 <= 읽음보냄.current) return;
    읽음보냄.current = 끝번호;
    // 목록의 수를 먼저 지운다 — 뒤로 가서 목록을 볼 때 서버를 기다리지 않게
    qc.setQueryData<{ items: 대화방줄[] }>(dm열쇠.목록, (v) =>
      v && { ...v, items: v.items.map((t) => (t.id === 방번호 ? { ...t, unread: 0 } : t)) });
    dmApi.markRead(방번호, 끝번호)
      .then(() => {
        qc.invalidateQueries({ queryKey: dm열쇠.안읽음 });
        qc.invalidateQueries({ queryKey: dm열쇠.목록 });
      })
      .catch(() => { 읽음보냄.current = 0; });
    void 대화알림닫기(방번호);
  }, [방번호, qc]);

  useEffect(() => { if (처음 === "됨") 읽음알리기(); }, [메시지들, 처음, 읽음알리기]);

  // ── 묻기 돌리기 — 화면이 보이는 동안만 ─────────────────────
  useEffect(() => {
    if (처음 !== "됨") return;
    let 끝 = false;
    let 시계: ReturnType<typeof setTimeout> | undefined;
    const 돌기 = async () => {
      if (끝) return;
      if (document.visibilityState !== "hidden") await 새로묻기();
      if (!끝) 시계 = setTimeout(돌기, 간격.current);
    };
    시계 = setTimeout(돌기, 간격.current);
    const 보임 = () => {
      if (document.visibilityState !== "visible") return;
      간격.current = 묻기간격.처음;
      void 새로묻기().then(읽음알리기);
    };
    document.addEventListener("visibilitychange", 보임);
    return () => {
      끝 = true;
      if (시계) clearTimeout(시계);
      document.removeEventListener("visibilitychange", 보임);
    };
  }, [처음, 새로묻기, 읽음알리기]);

  use메시지푸시((번호) => {
    if (처음 !== "됨" || (번호 != null && 번호 !== 방번호)) return;
    간격.current = 묻기간격.처음;
    void 새로묻기();
  });

  // ── 이전 메시지 ───────────────────────────────────────────
  const 이전받기 = useCallback(async () => {
    const 첫 = 메시지참조.current.find((m) => m.id > 0);
    if (이전받는참.current || !첫) return;
    이전받는참.current = true;
    set이전받는중(true);
    try {
      const r = await dmApi.getMessages(방번호, { before_id: 첫.id });
      const el = 스크롤러();
      할일.current = el ? { 종류: "보정", 높이: el.scrollHeight, 위치: el.scrollTop } : null;
      set메시지들((v) => 메시지합치기(v, r.items));
      set더있음(r.has_more);
    } catch {
      보이기("이전 메시지를 불러오지 못했어요", "error");
    } finally {
      이전받는참.current = false;
      set이전받는중(false);
    }
  }, [방번호, 스크롤러, 보이기]);

  /* 맨 위 '이전 메시지 보기' 가 보이면 저절로 — 대화가 짧아 화면이 안 차면 곧바로 더 받는다 */
  useEffect(() => {
    const 단추 = 위끝.current;
    if (!단추 || !더있음 || 처음 !== "됨" || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((들) => { if (들.some((x) => x.isIntersecting)) void 이전받기(); },
      { root: 스크롤러(), rootMargin: "200px 0px 0px 0px" });
    io.observe(단추);
    return () => io.disconnect();
  }, [더있음, 처음, 이전받기, 스크롤러]);

  // ── 보내기 ────────────────────────────────────────────────
  const 보내기 = useCallback(async (글: string, 다시?: 표시메시지) => {
    const 본문 = 글.trim();
    if (!본문 || 본문.length > DM_MAX) return;
    const 임시 = 다시?.임시 ?? `t${--임시순번.current}`;
    할일.current = { 종류: "바닥" };
    if (다시) {
      set메시지들((v) => v.map((m) => (m.임시 === 임시 ? { ...m, 상태: "보내는중" } : m)));
    } else {
      set메시지들((v) => [...v, {
        id: 임시순번.current, mine: true, body: 본문, deleted: false, blinded: false,
        created_at: new Date().toISOString(), 상태: "보내는중", 임시,
      }]);
    }
    try {
      const m = await dmApi.send(방번호, 본문);
      set메시지들((v) => 메시지합치기(v.filter((x) => x.임시 !== 임시), [m]));
      간격.current = 묻기간격.처음;
      qc.invalidateQueries({ queryKey: dm열쇠.목록 });
    } catch (e) {
      set메시지들((v) => v.map((x) => (x.임시 === 임시 ? { ...x, 상태: "실패" } : x)));
      const 코드 = 상태코드(e);
      if (코드 === 403) {
        보이기("메시지를 보낼 수 없어요", "error");
        qc.invalidateQueries({ queryKey: dm열쇠.방(방번호) });
      } else if (코드 === 429) {
        보이기("너무 빨리 보내고 있어요. 잠시 뒤 다시 보내 주세요", "error");
      } else {
        보이기("보내지 못했어요. 말풍선을 눌러 다시 보낼 수 있어요", "error");
      }
    }
  }, [방번호, qc, 보이기]);

  const 크기맞추기 = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  /* 보내고 입력칸을 비우면 높이도 한 줄로 — 여러 줄을 쓰다 보내면 큰 칸이 그대로 남았다 */
  useLayoutEffect(() => { if (!입력) 크기맞추기(입력칸.current); }, [입력]);

  const 입력보내기 = () => {
    if (!입력.trim()) return;
    const 글 = 입력;
    set입력("");
    void 보내기(글);
    입력칸.current?.focus();
  };

  const 키 = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글을 조합하는 중의 Enter 는 글자를 끝내는 것 — 보내면 마지막 글자가 한 번 더 간다
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.ctrlKey || e.metaKey || (넓음 && !e.shiftKey)) {
      e.preventDefault();
      입력보내기();
    }
  };

  // ── 말풍선 할 일 ──────────────────────────────────────────
  const 복사 = async (m: 표시메시지) => {
    set고른것(null);
    try {
      await navigator.clipboard.writeText(m.body ?? "");
      보이기("복사했어요", "success");
    } catch {
      보이기("복사하지 못했어요", "error");
    }
  };

  const 지우기 = (m: 표시메시지) => 확인묻기({
    title: "메시지를 지울까요?",
    message: "상대 화면에서도 '삭제된 메시지예요' 로 바뀌어요.",
    대상: (m.body ?? "").slice(0, 60),
    확인글: "삭제",
    onConfirm: async () => {
      try {
        await dmApi.deleteMessage(m.id);
        set메시지들((v) => v.map((x) => (x.id === m.id ? { ...x, deleted: true, body: null } : x)));
        set고른것(null);
        qc.invalidateQueries({ queryKey: dm열쇠.목록 });
      } catch {
        보이기("지우지 못했어요", "error");
      }
    },
  });

  const 버리기 = (m: 표시메시지) => {
    set메시지들((v) => v.filter((x) => x.임시 !== m.임시));
    set고른것(null);
  };

  // ── 위 ⋯ — 프로필·차단·나가기 ─────────────────────────────
  const 방다시 = () => {
    qc.invalidateQueries({ queryKey: dm열쇠.방(방번호) });
    if (상대?.id) qc.invalidateQueries({ queryKey: ["userPublicProfile", 상대.id] });
    qc.invalidateQueries({ queryKey: dm열쇠.차단 });
  };

  const 차단하기 = () => 확인묻기({
    title: `${상대?.name ?? "이 사람"}님을 차단할까요?`,
    message: "차단하면 서로 메시지를 보낼 수 없어요. 상대에게는 알리지 않아요. "
      + "메시지 목록의 '차단한 사람' 에서 풀 수 있어요.",
    확인글: "차단",
    onConfirm: async () => {
      if (!상대?.id) return;
      try {
        await dmApi.block(상대.id);
        방다시();
        보이기("차단했어요", "success");
      } catch {
        보이기("차단하지 못했어요", "error");
      }
    },
  });

  const 차단풀기 = async () => {
    if (!상대?.id) return;
    try {
      await dmApi.unblock(상대.id);
      방다시();
      보이기("차단을 풀었어요", "success");
    } catch {
      보이기("차단을 풀지 못했어요", "error");
    }
  };

  const 나가기 = () => 확인묻기({
    title: "대화방을 나갈까요?",
    message: "지금까지 나눈 메시지가 내 목록에서 사라져요. 상대에게는 그대로 남고, 새 메시지가 오면 다시 보여요.",
    확인글: "나가기",
    onConfirm: async () => {
      try {
        await dmApi.leave(방번호);
        qc.invalidateQueries({ queryKey: dm열쇠.목록 });
        qc.invalidateQueries({ queryKey: dm열쇠.안읽음 });
        navigate("/messages", { replace: true });
      } catch {
        보이기("나가지 못했어요", "error");
      }
    },
  });

  const 메뉴: 메뉴항목[] = 방 ? [
    ...(상대?.active && 상대.id ? [{ 이름: "프로필 보기", 아이콘: User, 누르면: () => navigate(`/profile/${상대.id}`) }] : []),
    ...(상대?.id ? [방.i_blocked
      ? { 이름: "차단 풀기", 아이콘: UserX, 누르면: () => void 차단풀기() }
      : { 이름: "차단하기", 아이콘: Ban, 위험: true, 누르면: 차단하기 }] : []),
    { 이름: "대화방 나가기", 아이콘: LogOut, 위험: true, 누르면: 나가기 },
  ] : [];

  /* 알림을 눌러 바로 들어왔으면 앱 안에 돌아갈 곳이 없다 — 그때는 목록으로 */
  const 뒤로 = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate("/messages");
  };

  const 줄들 = useMemo(() => 대화줄들(메시지들, 상대읽음), [메시지들, 상대읽음]);
  const 막힘글 = !방 || 방.can_send ? null
    : 방.i_blocked ? "차단한 상대예요. 차단을 풀면 다시 메시지를 주고받을 수 있어요."
    : !방.other.active ? "탈퇴했거나 이용이 멈춘 사용자라 메시지를 보낼 수 없어요."
    : "지금은 이 상대에게 메시지를 보낼 수 없어요.";

  // ── 그리기 ────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <빈화면 icon={LogIn} title="로그인하면 메시지를 볼 수 있어요"
        action={{ label: "로그인", onClick: () => navigate("/login") }} />
    );
  }
  const 없음 = !옳은번호 || 상태코드(방질의.error) === 404 || 상태코드(처음오류) === 404;
  if (없음) {
    return (
      <빈화면 icon={MessageCircle} title="대화를 찾을 수 없어요" hint="나간 대화방이거나 없는 주소예요"
        action={{ label: "메시지 목록으로", onClick: () => navigate("/messages", { replace: true }) }} />
    );
  }
  if (처음 === "실패") {
    return <못불러옴 사유={처음오류} 다시={() => { set다시시도((n) => n + 1); void 방질의.refetch(); }} />;
  }

  const 입력막힘 = !!막힘글;
  return (
    <>
      {/* 스크롤 고정(overflow-anchor)을 끈다 — 크롬은 내용이 바뀌면 보이던 말풍선을 제자리에 두려고 스크롤을 옮긴다.
          말풍선의 할 일 줄을 펼치면 아래로 붙은 대화가 위로 밀리고, 크롬이 그만큼 스크롤을 올려 펼친 줄이 입력칸
          뒤로 숨었다(브라우저에서 재 보고 알았다). 자리는 이 화면이 직접 잡는다(바닥 따라가기·이전 메시지 보정) */}
      <div ref={틀} className="min-h-screen flex flex-col [overflow-anchor:none]">
        {/* 위 띠 — ← · 상대 · ⋯ */}
        <div className="sticky top-0 z-20 bg-bg-card/90 backdrop-blur-md border-b border-border">
          <div className="max-w-2xl mx-auto px-3 sm:px-4 h-12 flex items-center gap-2">
            <button type="button" aria-label="뒤로" onClick={뒤로}
              className="p-1.5 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
              <ArrowLeft size={20} />
            </button>
            {상대 ? (
              상대.active && 상대.id ? (
                <Link to={`/profile/${상대.id}`} className="flex-1 min-w-0 flex items-center gap-2">
                  <Avatar username={상대.name} colorIndex={상대.avatar_color} avatarUrl={상대.avatar_url} size="base" />
                  <span className="text-sm font-semibold text-text-primary truncate">{상대.name}</span>
                </Link>
              ) : (
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <Avatar username={상대.name} colorIndex={상대.avatar_color} avatarUrl={상대.avatar_url} size="base" />
                  <span className="text-sm font-semibold text-text-muted truncate">{상대.name}</span>
                </div>
              )
            ) : (
              <span className="flex-1" />
            )}
            <글메뉴 항목들={메뉴} 이름="대화방 메뉴" 크기={20} className="mr-0.5" />
          </div>
        </div>

        {/* 메시지 — 짧은 대화는 입력칸 쪽(아래)에 붙는다 */}
        <div className="flex-1 flex flex-col justify-end">
          <div className="w-full max-w-2xl mx-auto px-2 sm:px-4 pt-2 pb-4">
            {더있음 && (
              <div className="flex justify-center py-2">
                <button ref={위끝} type="button" onClick={() => void 이전받기()} disabled={이전받는중}
                  className="px-3 py-1.5 rounded-full text-xs text-text-muted hover:text-accent-blue hover:bg-bg-elevated transition-colors disabled:opacity-50">
                  {이전받는중 ? "불러오는 중…" : "이전 메시지 보기"}
                </button>
              </div>
            )}
            {처음 === "받는중" ? (
              <div aria-busy="true" aria-label="메시지를 불러오는 중" className="flex flex-col gap-2 py-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className={cn("h-9 rounded-2xl bg-bg-elevated animate-pulse",
                    i % 2 ? "self-end w-1/2" : "self-start w-2/3")} />
                ))}
              </div>
            ) : 메시지들.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                {상대 && <Avatar username={상대.name} colorIndex={상대.avatar_color} avatarUrl={상대.avatar_url} size="xl" />}
                <p className="text-sm font-semibold text-text-primary">{상대?.name ?? ""}</p>
                <p className="text-xs text-text-muted break-keep">아직 나눈 메시지가 없어요. 먼저 인사를 건네 보세요</p>
              </div>
            ) : (
              <div role="log" aria-live="polite" aria-label={`${상대?.name ?? "상대"}님과의 대화`} className="flex flex-col">
                {줄들.map((줄) => 줄.종류 === "날짜" ? (
                  <div key={줄.key} className="flex justify-center my-3">
                    <span className="px-3 py-1 rounded-full bg-bg-elevated text-2xs text-text-muted">{줄.글}</span>
                  </div>
                ) : (
                  <말풍선 key={줄.key} 줄={줄} 상대={상대} 열림={고른것 === 줄.key}
                    누름={() => set고른것((k) => (k === 줄.key ? null : 줄.key))}>
                    {줄.m.상태 === "실패" ? (
                      <>
                        <작은단추 아이콘={RotateCw} onClick={() => { set고른것(null); void 보내기(줄.m.body ?? "", 줄.m); }}>다시 보내기</작은단추>
                        <작은단추 아이콘={Trash2} 위험 onClick={() => 버리기(줄.m)}>지우기</작은단추>
                      </>
                    ) : (
                      <>
                        {!줄.m.deleted && !줄.m.blinded && 줄.m.body && (
                          <작은단추 아이콘={Copy} onClick={() => void 복사(줄.m)}>복사</작은단추>
                        )}
                        {줄.m.mine && 줄.m.id > 0 && !줄.m.deleted && (
                          <작은단추 아이콘={Trash2} 위험 onClick={() => 지우기(줄.m)}>삭제</작은단추>
                        )}
                        {!줄.m.mine && 줄.m.id > 0 && !줄.m.deleted && !줄.m.blinded && (
                          <작은단추 아이콘={Flag} 위험 onClick={() => { set고른것(null); set신고할(줄.m); }}>신고</작은단추>
                        )}
                      </>
                    )}
                  </말풍선>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 입력칸 — 화면 아래(휴대폰은 아래 탭 자리, 자판이 올라오면 자판 위) */}
        <div data-dm-composer=""
          className={cn("z-30 bg-bg-card/95 backdrop-blur-md border-t border-border", 넓음 ? "sticky bottom-0" : "fixed inset-x-0")}
          style={넓음 ? undefined : {
            bottom: 자판 > 0 ? 자판 : 0,
            paddingBottom: 자판 > 0 ? undefined : "env(safe-area-inset-bottom)",
          }}>
          <div className="relative max-w-2xl mx-auto px-3 sm:px-4 py-2.5">
            {새것있음 && (
              <button type="button" onClick={() => 바닥으로(true)}
                className="absolute -top-11 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1.5 rounded-full bg-accent-blue text-white text-xs font-semibold shadow-float">
                새 메시지 <ArrowDown size={13} />
              </button>
            )}
            {입력막힘 ? (
              <div role="status" className="flex items-center gap-3 px-1 py-1.5">
                <p className="flex-1 text-xs text-text-muted break-keep">{막힘글}</p>
                {방?.i_blocked && (
                  <button type="button" onClick={() => void 차단풀기()}
                    className="shrink-0 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:border-accent-blue/50 hover:text-accent-blue transition-colors">
                    차단 풀기
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-end gap-2 bg-bg-elevated border border-border rounded-[22px] px-3.5 py-2 focus-within:border-accent-blue/50 transition-colors">
                <textarea ref={입력칸} value={입력} rows={1} aria-label="메시지 쓰기"
                  placeholder="메시지 보내기" maxLength={DM_MAX}
                  enterKeyHint={넓음 ? "send" : "enter"}
                  onChange={(e) => { set입력(e.target.value); 크기맞추기(e.target); }}
                  onKeyDown={키}
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-dim focus:outline-none resize-none overflow-hidden leading-relaxed min-h-[20px]" />
                {/* 누를 때 입력칸에서 초점을 빼앗지 않는다 — 휴대폰 자판이 닫혔다 열리며 화면이 튄다 */}
                <button type="button" aria-label="보내기" onMouseDown={(e) => e.preventDefault()}
                  onClick={입력보내기} disabled={!입력.trim()}
                  className="shrink-0 mb-0.5 transition-all active:scale-90 disabled:opacity-40">
                  <Send size={16} className={입력.trim() ? "text-accent-blue" : "text-text-dim"} />
                </button>
              </div>
            )}
            {!입력막힘 && 입력.length > DM_MAX - 100 && (
              <p className={cn("mt-1 px-2 text-right text-2xs", 입력.length >= DM_MAX ? "text-accent-red" : "text-text-dim")}>
                {입력.length.toLocaleString()}/{DM_MAX.toLocaleString()}
              </p>
            )}
          </div>
        </div>
        {/* 휴대폰 — 입력칸(fixed)에 마지막 메시지가 가리지 않게 */}
        {!넓음 && <div aria-hidden className="h-16" />}
      </div>

      {신고할 && (
        <신고창 무엇="메시지" 대상={(신고할.body ?? "").slice(0, 60)} 닫기={() => set신고할(null)}
          보내기={(사유) => 신고보내기(() => dmApi.report(신고할.id, 사유), "메시지", 보이기)} />
      )}
      {확인화면}
      {알림화면}
    </>
  );
}

/** 말풍선 한 줄 — 눌러서 할 일(복사·삭제·신고)을 펼친다 */
function 말풍선({ 줄, 상대, 열림, 누름, children }: {
  줄: Extract<대화줄, { 종류: "메시지" }>;
  상대?: 대화상대;
  열림: boolean;
  누름: () => void;
  children: React.ReactNode;
}) {
  const { m, 묶음첫, 묶음끝, 읽음 } = 줄;
  const 할일줄 = useRef<HTMLDivElement>(null);
  /* 펼친 할 일 줄이 입력칸 뒤에 숨으면 그만큼 올린다 — 맨 아래 말풍선을 누르면 줄이 입력칸 뒤에 생겼다.
     scrollIntoView 는 입력칸(화면에 고정)을 모르고, scroll-margin 을 줘도 크롬은 '이미 화면 안' 이라며 움직이지
     않았다(브라우저에서 재 보고 알았다). 입력칸 위끝을 직접 재서 넘친 만큼 내린다 */
  useEffect(() => {
    const 줄 = 할일줄.current;
    const 본문 = 줄?.closest("main");
    if (!열림 || !줄 || !본문) return;
    const 칸 = document.querySelector("[data-dm-composer]");
    const 한계 = (칸 ? 칸.getBoundingClientRect().top : 본문.getBoundingClientRect().bottom) - 8;
    const 넘침 = 줄.getBoundingClientRect().bottom - 한계;
    if (넘침 > 0) 본문.scrollBy?.({ top: 넘침, behavior: "smooth" });
  }, [열림]);
  const 가림 = m.deleted || m.blinded;
  const 글 = m.deleted ? "삭제된 메시지예요" : m.blinded ? "운영 정책으로 가려진 메시지예요" : m.body;
  const 곁글 = m.상태 === "보내는중" ? "보내는 중"
    : m.상태 === "실패" ? "못 보냄"
    : 묶음끝 ? 말풍선시각(m.created_at) : "";
  return (
    <div data-dm-message={m.mine ? "mine" : "theirs"}
      className={cn("flex flex-col", m.mine ? "items-end" : "items-start", 묶음첫 ? "mt-3" : "mt-1")}>
      <div className={cn("flex items-end gap-1.5 max-w-[85%] sm:max-w-[75%]", m.mine && "flex-row-reverse")}>
        {!m.mine && (
          묶음첫 && 상대
            ? <span className="self-start shrink-0"><Avatar username={상대.name} colorIndex={상대.avatar_color} avatarUrl={상대.avatar_url} size="base" /></span>
            : <span aria-hidden className="w-7 shrink-0" />
        )}
        <button type="button" onClick={누름} aria-expanded={열림}
          className={cn(
            "min-w-0 px-3.5 py-2 rounded-2xl text-left text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] transition-opacity",
            가림 ? "italic text-text-dim border border-dashed border-border bg-transparent"
              : m.mine ? "bg-accent-blue text-white"
              : "bg-bg-elevated text-text-primary border border-border-subtle",
            !가림 && m.mine && 묶음끝 && "rounded-br-sm",
            !가림 && !m.mine && 묶음첫 && "rounded-tl-sm",
            m.상태 === "보내는중" && "opacity-60",
            m.상태 === "실패" && "ring-1 ring-accent-red/60",
          )}>
          {글}
        </button>
        {곁글 && (
          <span className={cn("shrink-0 pb-0.5 text-2xs whitespace-nowrap",
            m.상태 === "실패" ? "text-accent-red font-semibold" : "text-text-dim")}>
            {곁글}
          </span>
        )}
      </div>
      {읽음 && <span className="mt-0.5 mr-1 text-2xs font-semibold text-accent-blue">읽음</span>}
      {열림 && (
        <div ref={할일줄} role="group" aria-label="메시지 할 일"
          className={cn("mt-1.5 flex flex-wrap gap-1.5", m.mine ? "justify-end" : "justify-start pl-9")}>
          {children}
        </div>
      )}
    </div>
  );
}
