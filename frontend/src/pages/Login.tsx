import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BarChart3, Eye, EyeOff } from "lucide-react";
import api from "@/api/client";
import { useAuthStore } from "@/store/authStore";
import SocialLoginButtons from "@/components/SocialLoginButtons";
import type { AxiosError } from "axios";

interface LoginResponse {
  access_token: string;
  user_id: number;
  username: string;
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  denied: "로그인이 취소되었습니다.",
  invalid_state: "요청이 만료되었습니다. 다시 시도해 주세요.",
  provider_error: "소셜 로그인 서비스에 연결할 수 없습니다.",
  no_user_info: "사용자 정보를 가져오지 못했습니다.",
  email_exists: "이미 가입된 이메일입니다. 아이디/비밀번호로 로그인해 주세요.",
  signup_failed: "회원가입 처리 중 오류가 발생했습니다.",
  inactive: "비활성화된 계정입니다.",
  unsupported: "지원하지 않는 로그인 방식입니다.",
  invalid_response: "로그인 처리 중 오류가 발생했습니다.",
};

export default function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [searchParams] = useSearchParams();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const oauthError = searchParams.get("oauth_error");
  const [error, setError] = useState<string | null>(
    oauthError ? OAUTH_ERROR_MESSAGES[oauthError] ?? "소셜 로그인에 실패했습니다." : null
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post<LoginResponse>("/auth/login", {
        username,
        password,
      });
      login(data.access_token, data.user_id, data.username);
      navigate("/");
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setError(
        axiosErr.response?.data?.detail ?? "로그인에 실패했습니다. 다시 시도해 주세요."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center flex-shrink-0">
            <BarChart3 size={18} className="text-white" />
          </div>
          <div>
            <div className="text-base font-bold text-text-primary tracking-tight leading-none">
              StockPlatform
            </div>
            <div className="text-2xs text-text-dim mt-0.5">종목발굴 &amp; 백테스트</div>
          </div>
        </div>

        {/* 카드 */}
        <div className="bg-bg-card border border-border rounded-2xl p-7 shadow-lg">
          <h1 className="text-lg font-semibold text-text-primary mb-1">로그인</h1>
          <p className="text-xs text-text-muted mb-6">계정에 로그인하여 이용하세요</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* 아이디 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary" htmlFor="login-username">
                아이디
              </label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="아이디를 입력하세요"
                className="w-full px-3 py-2.5 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/30 transition-all"
              />
            </div>

            {/* 비밀번호 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary" htmlFor="login-pw">
                비밀번호
              </label>
              <div className="relative">
                <input
                  id="login-pw"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호를 입력하세요"
                  className="w-full px-3 py-2.5 pr-10 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/30 transition-all"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-muted transition-colors"
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* 에러 메시지 */}
            {error && (
              <div className="px-3 py-2 rounded-lg bg-accent-red/10 border border-accent-red/20 text-xs text-accent-red">
                {error}
              </div>
            )}

            {/* 제출 버튼 */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:bg-accent-blue/90 active:bg-accent-blue/80 disabled:opacity-50 disabled:cursor-not-allowed transition-all mt-1"
            >
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>

          <SocialLoginButtons />

          <div className="mt-5 text-center text-xs text-text-muted">
            계정이 없으신가요?{" "}
            <Link
              to="/register"
              className="text-accent-blue hover:text-accent-blue/80 font-medium transition-colors"
            >
              회원가입
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
