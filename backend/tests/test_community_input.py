"""
게시글·댓글이 받는 값의 형태를 고정한다.

첨부물(투표·종목태그·포트폴리오)은 예전에 "dict인지 list인지"만 보고 내부는 전혀
확인하지 않았다. 그래서 투표 보기 자리에 숫자를 넣으면 목록을 만들 때 len()이 터져
피드와 모든 종목 커뮤니티가 500으로 죽었다. 자기 글 하나를 정상 API로 수정하는
것만으로 가능했고, 같은 목록에 있던 남의 글까지 함께 사라졌다.

동시에 '화면이 실제로 보내는 값'은 반드시 통과해야 한다. 검증을 조이다가 현금이
들어간 포트폴리오 공유를 막아버린 적이 있어서 그쪽도 같이 못 박아 둔다.
"""
import pytest
from pydantic import ValidationError

from app.api.routes.community import (
    PostCreate, PostUpdate, CommentCreate, CommentUpdate,
    encode_content, decode_content, _plain,
    _BODY_MAX, _TITLE_MAX, _COMMENT_MAX, _TAGS_MAX,
)

TAG  = {"symbol": "005930", "market": "KR", "name": "삼성전자"}
POLL = {"question": "오를까?", "options": ["예", "아니오"]}
# 내 자산의 현금 항목 — 종목코드가 한글이라 형식을 강제하면 여기서 걸린다
CASH = {"symbol": "현금", "market": "KR", "name": "원화 현금", "shares": 1,
        "avg_price": 3_000_000, "currency": "KRW", "input_exchange_rate": None,
        "current_price": None, "asset_class": "현금"}


# ── 목록을 통째로 죽이던 값들 ─────────────────────────────────
class Test첨부물_형태:
    @pytest.mark.parametrize("poll, 설명", [
        ({"question": "q", "options": 5},          "보기가 리스트가 아님 (피드 500의 원인)"),
        ({"question": "q", "options": "예,아니오"}, "보기가 문자열"),
        ({"question": "q", "options": ["하나"]},    "보기 1개"),
        ({"question": "q", "options": []},         "보기 없음"),
        ({"question": "q", "options": [1, 2]},     "보기가 숫자"),
        ({"question": "q", "options": ["a"] * 100}, "보기 100개"),
        ({"question": "가" * 200, "options": ["a", "b"]}, "질문이 너무 김"),
        ({"options": ["a", "b"]},                  "질문 없음"),
    ])
    def test_망가진_투표는_저장되지_않는다(self, poll, 설명):
        with pytest.raises(ValidationError):
            PostCreate(body="x", poll=poll)
        # 수정 경로로도 같은 값이 들어갈 수 없어야 한다 — 원래 공격 경로가 수정이었다
        with pytest.raises(ValidationError):
            PostUpdate(body="x", poll=poll)

    @pytest.mark.parametrize("tags, 설명", [
        (["005930"],                              "태그가 문자열"),
        ([{"market": "KR"}],                      "종목코드 없음"),
        ([{"symbol": "005930"}],                  "시장 없음"),
        ([{"symbol": "005930", "market": "XX"}],  "없는 시장"),
        ([{"symbol": "", "market": "KR"}],        "빈 종목코드"),
        ([TAG] * (_TAGS_MAX + 1),                 "태그 상한 초과"),
    ])
    def test_망가진_태그는_저장되지_않는다(self, tags, 설명):
        with pytest.raises(ValidationError):
            PostCreate(body="x", tags=tags)

    @pytest.mark.parametrize("pf, 설명", [
        ([{"symbol": "A", "market": "KR", "shares": "많이"}], "수량이 숫자가 아님"),
        ([{"symbol": "A", "market": "KR", "shares": -5}],     "수량이 음수"),
        ([{"symbol": "A", "market": "KR", "avg_price": -1}],  "단가가 음수"),
        (["005930"],                                          "항목이 문자열"),
        ([{"symbol": "A", "market": "KR"}] * 51,              "항목 상한 초과"),
    ])
    def test_망가진_포트폴리오는_저장되지_않는다(self, pf, 설명):
        with pytest.raises(ValidationError):
            PostCreate(body="x", portfolio=pf)


# ── 화면이 실제로 보내는 값 ───────────────────────────────────
class Test실제_화면_입력:
    def test_투표와_태그가_붙은_글(self):
        p = PostCreate(body="본문", poll=POLL, tags=[TAG])
        assert p.poll.options == ["예", "아니오"]
        assert p.tags[0].symbol == "005930"

    def test_현금이_든_포트폴리오도_공유된다(self):
        # 현금은 종목코드가 "현금"이다. 코드 형식을 강제하면 현금을 가진
        # 사용자는 포트폴리오 공유가 통째로 막힌다
        p = PostCreate(body="📊 포트폴리오 공유", portfolio=[CASH])
        assert p.portfolio[0].symbol == "현금"
        assert p.portfolio[0].asset_class == "현금"

    def test_보유_종목이_많아도_태그가_다_붙는다(self):
        # 포트폴리오 공유는 보유 종목 수만큼 태그를 자동으로 붙인다.
        # 직접 붙이는 태그 한도(5개)를 그대로 적용하면 여기서 막힌다
        many = [{"symbol": f"{100000+i:06d}", "market": "KR"} for i in range(30)]
        assert len(PostCreate(body="x", tags=many).tags) == 30

    def test_구버전_프론트의_content_도_받는다(self):
        assert PostCreate(content="옛 형태").body == "옛 형태"

    def test_첨부물이_없는_평범한_글(self):
        p = PostCreate(body="그냥 글", poll=None, tags=[], portfolio=None)
        assert p.poll is None and p.tags == [] and p.portfolio is None


# ── 길이 제한: 작성과 수정이 같아야 한다 ──────────────────────
class Test길이_제한:
    def test_수정으로_길이_제한을_우회할_수_없다(self):
        # 예전에는 수정 스키마에 검증이 하나도 없어서 정상 작성 → 즉시 수정만으로
        # 본문 100만자를 저장할 수 있었다
        long = "가" * (_BODY_MAX + 1)
        with pytest.raises(ValidationError):
            PostCreate(body=long)
        with pytest.raises(ValidationError):
            PostUpdate(body=long)

    def test_댓글도_작성과_수정이_같은_기준이다(self):
        long = "가" * (_COMMENT_MAX + 1)
        with pytest.raises(ValidationError):
            CommentCreate(content=long)
        with pytest.raises(ValidationError):
            CommentUpdate(content=long)

    @pytest.mark.parametrize("빈값", ["", "   ", "\n\n"])
    def test_내용이_비면_거부한다(self, 빈값):
        for model in (PostCreate, PostUpdate):
            with pytest.raises(ValidationError):
                model(body=빈값)
        for model in (CommentCreate, CommentUpdate):
            with pytest.raises(ValidationError):
                model(content=빈값)

    def test_제목은_길이만_제한한다(self):
        assert PostCreate(body="x", title="").title == ""
        with pytest.raises(ValidationError):
            PostCreate(body="x", title="가" * (_TITLE_MAX + 1))


# ── 저장 형식 ─────────────────────────────────────────────────
class Test저장_왕복:
    def test_검증한_첨부물이_그대로_저장되고_읽힌다(self):
        # 검증은 Pydantic 모델로 하지만 저장은 JSON 문자열이다.
        # 모델 객체를 그대로 넘기면 json.dumps가 터져 글 등록이 500이 된다
        p = PostCreate(body="본문", poll=POLL, tags=[TAG], portfolio=[CASH])
        raw = encode_content(p.title, p.body, "", p.poll, p.tags, p.portfolio)
        back = decode_content(raw)
        assert back["poll"]["options"] == ["예", "아니오"]
        assert back["tags"] == [TAG]
        assert back["portfolio"][0]["symbol"] == "현금"

    def test_읽어온_dict를_다시_저장해도_같다(self):
        # 수정은 기존 글을 읽어(dict) 그대로 다시 저장한다.
        # 모델과 dict 어느 쪽이 들어와도 결과가 같아야 한다
        p = PostCreate(body="본문", poll=POLL, tags=[TAG])
        once  = encode_content("", "본문", "", p.poll, p.tags, None)
        d     = decode_content(once)
        twice = encode_content("", "본문", "", d["poll"], d["tags"], None)
        assert once == twice

    @pytest.mark.parametrize("v, 기대", [(None, None), ([], []), ("문자열", "문자열")])
    def test_모델이_아닌_값은_건드리지_않는다(self, v, 기대):
        assert _plain(v) == 기대
