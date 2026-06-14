import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import Logo from "@/components/Logo";
import api from "@/api/client";
import { useAuthStore } from "@/store/authStore";
import SocialLoginButtons from "@/components/SocialLoginButtons";
import type { AxiosError } from "axios";

interface RegisterResponse {
  access_token: string;
  user_id: number;
  username: string;
}

export default function Register() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const usernameValid = /^[a-zA-Z0-9_]+$/.test(username) && username.length >= 3;
  const pwLongEnough = password.length >= 8;
  const pwHasLetter = /[A-Za-z]/.test(password);
  const pwHasNumber = /\d/.test(password);
  const pwHasSpecial = /[^A-Za-z0-9]/.test(password);
  const pwValid = pwLongEnough && pwHasLetter && pwHasNumber && pwHasSpecial;
  const pwMatch = password === confirmPw;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!usernameValid) {
      setError("아이디는 3자 이상, 영문/숫자/_만 사용 가능합니다.");
      return;
    }
    if (!pwValid) {
      setError("비밀번호는 영문자, 숫자, 특수문자를 모두 포함하여 8자 이상이어야 합니다.");
      return;
    }
    if (!pwMatch) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post<RegisterResponse>("/auth/register", {
        username,
        password,
      });
      login(data.access_token, data.user_id, data.username);
      navigate("/");
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      setError(
        axiosErr.response?.data?.detail ?? "회원가입에 실패했습니다. 다시 시도해 주세요."
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
          <Logo size={36} />
          <div>
            <div className="text-base font-bold text-text-primary tracking-tight leading-none">
              StockPlatform
            </div>
            <div className="text-2xs text-text-dim mt-0.5">종목발굴 &amp; 백테스트</div>
          </div>
        </div>

        {/* 카드 */}
        <div className="bg-bg-card border border-border rounded-2xl p-7 shadow-lg">
          <h1 className="text-lg font-semibold text-text-primary mb-1">회원가입</h1>
          <p className="text-xs text-text-muted mb-6">새 계정을 만들어 시작하세요</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* 아이디 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary" htmlFor="reg-username">
                아이디
              </label>
              <input
                id="reg-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="영문/숫자/_ 3자 이상"
                className="w-full px-3 py-2.5 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/30 transition-all"
              />
              {username.length > 0 && !usernameValid && (
                <p className="text-2xs text-accent-red">영문/숫자/_ 3자 이상 입력하세요.</p>
              )}
              {username.length >= 3 && usernameValid && (
                <p className="text-2xs text-accent-green">사용 가능한 형식입니다.</p>
              )}
            </div>

            {/* 비밀번호 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary" htmlFor="reg-pw">
                비밀번호
              </label>
              <div className="relative">
                <input
                  id="reg-pw"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="영문, 숫자, 특수문자 포함 8자 이상"
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
              {password.length > 0 && !pwLongEnough && (
                <p className="text-2xs text-accent-red">비밀번호는 최소 8자 이상이어야 합니다.</p>
              )}
              {password.length >= 8 && (!pwHasLetter || !pwHasNumber || !pwHasSpecial) && (
                <p className="text-2xs text-accent-red">영문자, 숫자, 특수문자를 모두 포함해야 합니다.</p>
              )}
            </div>

            {/* 비밀번호 확인 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary" htmlFor="reg-pw-confirm">
                비밀번호 확인
              </label>
              <div className="relative">
                <input
                  id="reg-pw-confirm"
                  type={showConfirmPw ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="비밀번호를 다시 입력하세요"
                  className="w-full px-3 py-2.5 pr-10 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/30 transition-all"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowConfirmPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-muted transition-colors"
                >
                  {showConfirmPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {confirmPw.length > 0 && !pwMatch && (
                <p className="text-2xs text-accent-red">비밀번호가 일치하지 않습니다.</p>
              )}
              {confirmPw.length > 0 && pwMatch && pwValid && (
                <p className="text-2xs text-accent-green">비밀번호가 일치합니다.</p>
              )}
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
              {loading ? "가입 중..." : "회원가입"}
            </button>
          </form>

          <SocialLoginButtons />

          <div className="mt-5 text-center text-xs text-text-muted">
            이미 계정이 있으신가요?{" "}
            <Link
              to="/login"
              className="text-accent-blue hover:text-accent-blue/80 font-medium transition-colors"
            >
              로그인
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
