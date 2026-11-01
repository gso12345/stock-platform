/**
 * 로그인해야 쓰는 화면에 로그인 전에 들어왔을 때 — 왜 로그인해야 하는지와 로그인 단추.
 *
 * 메뉴는 로그인 전에도 모두 보인다(사용자: "로그인 안한상태에서도 메뉴를 모두 나오도록 해줘"). 그 메뉴를
 * 눌렀을 때 곧바로 로그인 화면으로 튕기면 왜 갔는지 모른다 — 그 자리에서 말한다.
 */
import { Link } from "react-router-dom";
import { LogIn, type LucideIcon } from "lucide-react";

export default function 로그인필요({ icon: Icon, 글 }: { icon: LucideIcon; 글: string }) {
  return (
    <div className="max-w-2xl mx-auto py-16 text-center">
      <Icon size={28} className="mx-auto mb-3 text-text-dim opacity-50" />
      <p className="text-sm text-text-muted mb-4 break-keep">{글}</p>
      <Link to="/login"
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 transition-all">
        <LogIn size={13} /> 로그인
      </Link>
    </div>
  );
}
