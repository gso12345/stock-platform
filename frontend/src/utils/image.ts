/**
 * 첨부 이미지 압축 — 피드와 종목 커뮤니티가 같은 규칙을 쓰도록 한곳에 모았다.
 *
 * 이전에는 두 화면이 거의 같은 함수를 각자 들고 있었고, 그중 하나는 img.onerror를
 * 달지 않아 이미지가 아닌 파일을 고르면 Promise가 영원히 끝나지 않았다(버튼이
 * 계속 '처리 중'인 채로 멈춘다). 캔버스를 못 얻는 경우도 한쪽만 처리하고 있었다.
 */

/** 긴 변 기준 최대 픽셀 — 피드 카드에 필요한 해상도 */
const MAX_SIZE = 800;
const JPEG_QUALITY = 0.7;

/** 서버가 받는 상한(약 1.5MB)과 같은 기준. 넘으면 저장 단계에서 422가 난다 */
export const IMAGE_MAX_CHARS = 1_500_000;

export async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("이미지 파일만 첨부할 수 있습니다"));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    const done = (fn: () => void) => { URL.revokeObjectURL(url); fn(); };

    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_SIZE || height > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { done(() => reject(new Error("이미지를 처리할 수 없습니다"))); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      if (dataUrl.length > IMAGE_MAX_CHARS) {
        done(() => reject(new Error("이미지가 너무 큽니다. 더 작은 사진을 선택해 주세요")));
        return;
      }
      done(() => resolve(dataUrl));
    };
    img.onerror = () => done(() => reject(new Error("이미지를 읽을 수 없습니다")));
    img.src = url;
  });
}
