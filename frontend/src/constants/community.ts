/**
 * 글·댓글 입력 길이 제한 — 서버(backend/app/api/routes/community.py)와 같은 값이어야 한다.
 *
 * 화면은 본문을 5000자까지 받아들이는데 서버는 2000자에서 거부했다. 2500자를 쓰고
 * 등록을 누르면 "게시글 작성에 실패했습니다"만 뜨고 쓴 내용이 왜 막혔는지 알 수
 * 없었다. 세 화면(피드·종목 커뮤니티·글 상세)이 각자 숫자를 들고 있어서 생긴 일이라
 * 한곳에 모은다.
 */
export const BODY_MAX = 2000;
export const TITLE_MAX = 100;
export const COMMENT_MAX = 500;
export const POLL_QUESTION_MAX = 100;
export const POLL_OPTION_MAX = 50;
export const POLL_OPTION_MIN_COUNT = 2;
export const POLL_OPTION_MAX_COUNT = 4;
/** 직접 붙이는 종목 태그 개수 (포트폴리오 공유는 보유 종목만큼 자동으로 붙는다) */
export const CUSTOM_TAG_MAX = 5;
