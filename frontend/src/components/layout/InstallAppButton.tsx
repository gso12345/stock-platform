import { useState } from "react";
import { Download, X, Share, PlusSquare } from "lucide-react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Modal } from "@/components/ui";

function IOSInstallGuide({ onClose }: { onClose: () => void }) {
  return (
    // 공용 창 — 휴대폰에서는 아래에서 올라오는 시트, PC 는 가운데 창
    <Modal maxWidth="max-w-sm" backdropOpacity={70} onClose={onClose}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary">앱으로 설치하기</h3>
          <button aria-label="닫기" onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated">
            <X size={14} />
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4 text-sm text-text-secondary">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center flex-shrink-0">
              <Share size={14} className="text-accent-blue" />
            </div>
            <p>Safari 하단의 <b className="text-text-primary">공유</b> 버튼을 누르세요</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center flex-shrink-0">
              <PlusSquare size={14} className="text-accent-blue" />
            </div>
            <p><b className="text-text-primary">홈 화면에 추가</b>를 선택하세요</p>
          </div>
        </div>
        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm font-semibold rounded-lg bg-accent-blue text-white hover:bg-accent-blue transition-colors"
          >
            확인
          </button>
        </div>
    </Modal>
  );
}

export default function InstallAppButton({ className, iconSize = 15, onAfterClick }: {
  className?: string;
  iconSize?: number;
  onAfterClick?: () => void;
}) {
  const { canPrompt, promptInstall, installed, isIOS } = useInstallPrompt();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (installed || !(canPrompt || isIOS)) return null;

  const handleClick = async () => {
    if (canPrompt) {
      await promptInstall();
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
    onAfterClick?.();
  };

  return (
    <>
      <button onClick={handleClick} className={className}>
        <Download size={iconSize} className="flex-shrink-0" />앱 설치
      </button>
      {showIOSGuide && <IOSInstallGuide onClose={() => setShowIOSGuide(false)} />}
    </>
  );
}
