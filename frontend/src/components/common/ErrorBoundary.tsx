/**
 * 화면 그리다 터진 것을 여기서 받는다.
 *
 * 없으면 React 는 트리를 통째로 걷어낸다 — 사용자에게는 흰 화면이다.
 * 새로고침해도 같은 주소라 또 흰 화면이고, 무엇이 잘못됐는지 알 방법도 없다.
 *
 * 실제로 그런 자리가 있었다.
 *   - 종목상세의 decodeURIComponent: /stocks/KR/% 같은 주소면 URIError 를 던진다
 *   - localStorage 에 든 사용자설정을 JSON.parse 해서 그대로 쓰던 곳
 * 각각은 따로 막았지만, 앞으로 어디서 무엇이 터질지는 알 수 없다. 마지막
 * 그물을 하나 쳐 두면 최악이 '흰 화면' 에서 '다시 시도 버튼' 으로 바뀐다.
 *
 * 되돌아갈 길을 두 개 준다 — 다시 그려 보기(일시적인 문제였을 수 있다)와
 * 홈으로(그 화면 자체가 망가졌으면 벗어나야 한다).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { 오류보내기 } from "@/utils/오류보내기";

interface Props {
  children: ReactNode;
  /** 되돌리기를 눌렀을 때 다시 그릴 키. 라우트가 바뀌면 저절로 풀리게 쓴다 */
  resetKey?: string;
}

interface State {
  터짐: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { 터짐: null };

  static getDerivedStateFromError(error: Error): State {
    return { 터짐: error };
  }

  componentDidUpdate(이전: Props) {
    // 다른 화면으로 옮겨 갔으면 지난 오류를 붙들고 있을 이유가 없다
    if (this.state.터짐 && 이전.resetKey !== this.props.resetKey) {
      this.setState({ 터짐: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 콘솔에는 남긴다 — 사용자에게 보여 줄 것은 아래 화면뿐이다
    console.error("화면 오류:", error, info.componentStack);
    /* 서버에도 보낸다.
       콘솔은 사용자 브라우저에만 있어서, 흰 화면을 본 사람이 말해 주지
       않으면 우리는 영영 모른다. 오늘까지 화면 고장을 전부 제보로 알았다. */
    오류보내기(error.name, `${error.message}\n${error.stack ?? ""}\n${info.componentStack ?? ""}`);
  }

  render() {
    const { 터짐 } = this.state;
    if (!터짐) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 px-6 text-center">
        <div className="w-12 h-12 rounded-full bg-accent-red/15 flex items-center justify-center text-accent-red text-xl">!</div>
        <div className="flex flex-col gap-1">
          <p className="text-text-primary font-semibold">화면을 그리지 못했어요</p>
          <p className="text-sm text-text-muted">잠시 후 다시 시도해 주세요</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => this.setState({ 터짐: null })}
            className="px-4 py-2.5 bg-accent-blue text-white text-sm font-semibold rounded-lg"
          >
            다시 시도
          </button>
          <button
            onClick={() => { window.location.href = "/"; }}
            className="px-4 py-2.5 text-text-muted text-sm rounded-lg border border-border"
          >
            홈으로
          </button>
        </div>
        {import.meta.env.DEV && (
          <pre className="mt-2 max-w-full overflow-x-auto text-left text-2xs text-text-dim">
            {터짐.message}
          </pre>
        )}
      </div>
    );
  }
}
