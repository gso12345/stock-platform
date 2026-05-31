import axios from "axios";

const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : "/api/v1";

const api = axios.create({
  baseURL: BASE,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem("stkplt_auth");
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { token?: string } };
      const token = parsed?.state?.token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
  } catch {
    // localStorage 파싱 실패 시 무시
  }
  return config;
});

export default api;
