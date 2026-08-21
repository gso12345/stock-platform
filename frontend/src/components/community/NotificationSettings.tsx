/**
 * 알림 설정 — 어떤 반응을 알림으로 받을지 고른다.
 *
 * 설정은 서버에 저장한다. 화면에서만 걸러내면 꺼둔 알림도 계속 쌓여
 * 안 읽은 개수에 잡히고, 기기를 바꾸면 설정이 따라오지 않는다.
 *
 * 저장은 누른 즉시 반영하고(낙관적 갱신), 실패하면 되돌린다. 스위치를 누른 뒤
 * 응답을 기다리는 동안 멈춰 보이면 두 번 누르게 된다.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, ChevronDown } from "lucide-react";
import { communityApi } from "@/api/stocks";
import { KIND_META, NOTIFICATION_KINDS, type NotificationKind } from "@/constants/notifications";

type Settings = Record<NotificationKind, boolean>;

const ALL_ON = Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, true])) as Settings;

/** 스위치 목록 — 전체 알림 화면과 설정 모달이 같은 것을 쓴다 */
export function NotificationToggles() {
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<Settings>({
    queryKey: ["notiSettings"],
    queryFn: communityApi.getNotificationSettings,
    staleTime: 5 * 60_000,
  });

  const save = useMutation({
    mutationFn: (next: Settings) => communityApi.updateNotificationSettings(next),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ["notiSettings"] });
      const prev = qc.getQueryData<Settings>(["notiSettings"]);
      qc.setQueryData(["notiSettings"], next);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      // 저장에 실패했는데 켜진 채로 두면, 안 오는 알림을 계속 기다리게 된다
      if (ctx?.prev) qc.setQueryData(["notiSettings"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notiUnread"] }),
  });

  const settings: Settings = data ?? ALL_ON;
  // 지금 설정을 모르는 상태에서 스위치를 누르면, 화면에 보이던 기본값(전부 켜짐)이
  // 그대로 저장돼 실제로 꺼둔 항목이 되살아난다. 값을 받기 전에는 잠가 둔다.
  const 잠금 = isLoading || isError;

  if (isError) {
    return (
      <div className="px-4 py-4 flex items-center gap-3">
        <p className="flex-1 text-2xs text-text-dim break-keep">
          알림 설정을 불러오지 못했습니다
        </p>
        <button
          onClick={() => refetch()}
          className="px-2.5 py-1.5 rounded-lg border border-border text-2xs text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <>
      {NOTIFICATION_KINDS.map((kind) => {
        const meta = KIND_META[kind];
        const on = settings[kind];
        return (
          <div key={kind} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-b-0">
            <meta.Icon size={14} className={`shrink-0 ${on ? meta.cls : "text-text-dim"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-text-primary break-keep">{meta.label}</p>
              <p className="text-2xs text-text-dim break-keep">{meta.desc}</p>
            </div>
            <button
              role="switch"
              aria-checked={on}
              aria-label={`${meta.label} 알림`}
              disabled={잠금}
              onClick={() => save.mutate({ ...settings, [kind]: !on })}
              className={`relative w-10 h-6 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                on ? "bg-accent-blue" : "bg-bg-elevated border border-border"
              }`}
            >
              <span
                className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow transition-all ${
                  on ? "left-[1.25rem]" : "left-1"
                }`}
              />
            </button>
          </div>
        );
      })}
      {save.isError && (
        <p className="px-4 py-2 text-2xs text-accent-red">
          설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요
        </p>
      )}
    </>
  );
}

/** 전체 알림 화면에 들어가는 접었다 펴는 카드 */
export default function NotificationSettings({
  open, onToggle,
}: { open: boolean; onToggle: () => void }) {
  const { data, isLoading } = useQuery<Settings>({
    queryKey: ["notiSettings"],
    queryFn: communityApi.getNotificationSettings,
    staleTime: 5 * 60_000,
  });
  const settings = data ?? ALL_ON;
  const 꺼진개수 = NOTIFICATION_KINDS.filter((k) => !settings[k]).length;

  return (
    <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-bg-elevated transition-colors"
      >
        <BellRing size={14} className="text-text-muted" />
        <span className="text-xs font-semibold text-text-primary">알림 설정</span>
        <span className="text-2xs text-text-dim">
          {isLoading ? "" : 꺼진개수 === 0 ? "모두 받는 중" : `${꺼진개수}개 꺼둠`}
        </span>
        <div className="flex-1" />
        <ChevronDown size={14}
          className={`text-text-dim transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-border"><NotificationToggles /></div>}
    </div>
  );
}
