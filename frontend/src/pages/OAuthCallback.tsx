import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "@/api/client";
import { useAuthStore } from "@/store/authStore";

interface ExchangeResponse {
  access_token: string;
  user_id: number;
  username: string;
}

export default function OAuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const login = useAuthStore((s) => s.login);

  useEffect(() => {
    const code = params.get("code");
    if (!code) {
      navigate("/login?oauth_error=invalid_response", { replace: true });
      return;
    }
    api
      .post<ExchangeResponse>("/auth/oauth/exchange", { code })
      .then(({ data }) => {
        login(data.access_token, data.user_id, data.username);
        navigate("/", { replace: true });
      })
      .catch(() => {
        navigate("/login?oauth_error=invalid_response", { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-base">
      <div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
