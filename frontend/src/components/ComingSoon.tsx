import { Construction } from "lucide-react";

export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-32 text-center">
      <Construction size={40} className="text-text-dim" />
      <h2 className="text-lg font-semibold text-text-primary">{title} 서비스 준비중입니다</h2>
      <p className="text-sm text-text-muted">더 나은 기능으로 곧 찾아오겠습니다.</p>
    </div>
  );
}
