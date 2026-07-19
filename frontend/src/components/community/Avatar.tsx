import { Link } from "react-router-dom";

const AVATAR_COLORS = [
  "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "bg-rose-500/20 text-rose-400 border-rose-500/30",
  "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  "bg-orange-500/20 text-orange-400 border-orange-500/30",
];

interface AvatarProps {
  username: string;
  colorIndex: number;
  avatarUrl?: string | null;
  userId?: number;
  isMine?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  onClick?: () => void;
}

export default function Avatar({ username, colorIndex, avatarUrl, userId, isMine, size = "md", onClick }: AvatarProps) {
  const cls = AVATAR_COLORS[(colorIndex ?? 0) % AVATAR_COLORS.length];
  const sz =
    size === "xl" ? "w-20 h-20 text-3xl border-2" :
    size === "lg" ? "w-10 h-10 text-sm border-2" :
    size === "md" ? "w-8 h-8 text-xs border-2" :
    size === "sm" ? "w-6 h-6 text-xs border" :
                    "w-5 h-5 text-2xs border";

  const inner = avatarUrl ? (
    <img
      src={avatarUrl}
      alt={username}
      className={`${sz} rounded-full object-cover shrink-0`}
    />
  ) : (
    <div className={`rounded-full flex items-center justify-center font-bold shrink-0 ${sz} ${cls}`}>
      {(username ?? "?")[0]?.toUpperCase()}
    </div>
  );

  if (onClick) return <button onClick={onClick} className="shrink-0">{inner}</button>;
  if (userId == null) return inner;
  return <Link to={isMine ? "/mypage" : `/profile/${userId}`} className="shrink-0">{inner}</Link>;
}
