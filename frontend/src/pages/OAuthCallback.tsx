import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

export default function OAuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const login = useAuthStore((s) => s.login);

  useEffect(() => {
    const token = params.get("token");
    const userId = params.get("user_id");
    const username = params.get("username");
    if (token && userId && username) {
      login(token, Number(userId), username);
      navigate("/", { replace: true });
    } else {
      navigate("/login?oauth_error=invalid_response", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-base">
      <div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
