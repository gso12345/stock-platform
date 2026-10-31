"""웹 푸시 — 앱을 닫아도 알림이 휴대폰에.

망가지는 길이 여럿이라 하나씩 못 박는다.
  · 암호화가 틀리면 휴대폰은 말없이 버린다 — RFC 8291 부록 A 의 예시 값과 바이트까지 맞추고,
    받는 쪽처럼 직접 풀어 내용이 맞는지 본다
  · 서명이 틀리면 푸시 서버가 거절한다(403) — 공개키로 서명을 검증한다
  · 아무 주소나 받으면 우리 서버가 그 주소로 요청을 보낸다 — 알려진 푸시 서버만
  · 앱을 지운 기기(410)는 지우고, 남의 알림이 내 휴대폰에 가지 않는다
"""
import base64
import json
import time
from datetime import date, datetime, timezone

import httpx
import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import webpush as W
from app.services import push_service as P


# ── 받는 쪽 흉내 — 휴대폰(브라우저)이 하는 일 ────────────────────
class 기기:
    """구독 열쇠를 만들고, 받은 푸시를 풀어 본다(RFC 8291 의 받는 쪽)"""

    def __init__(self, 끝점="https://fcm.googleapis.com/fcm/send/abc"):
        self.키 = ec.generate_private_key(ec.SECP256R1())
        self.auth = b"0123456789abcdef"
        self.endpoint = 끝점

    @property
    def p256dh(self) -> str:
        return W.b64u(self.키.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))

    @property
    def auth_글(self) -> str:
        return W.b64u(self.auth)

    def 풀기(self, 몸: bytes) -> bytes:
        소금, rs, 키길이 = 몸[:16], int.from_bytes(몸[16:20], "big"), 몸[20]
        서버점 = 몸[21:21 + 키길이]
        암호문 = 몸[21 + 키길이:]
        assert rs == 4096 and 키길이 == 65
        서버 = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), 서버점)
        공유 = self.키.exchange(ec.ECDH(), 서버)
        내점 = W.unb64u(self.p256dh)
        hk = lambda s, k, i, n: HKDF(algorithm=hashes.SHA256(), length=n, salt=s, info=i).derive(k)
        ikm = hk(self.auth, 공유, b"WebPush: info\x00" + 내점 + 서버점, 32)
        cek = hk(소금, ikm, b"Content-Encoding: aes128gcm\x00", 16)
        nonce = hk(소금, ikm, b"Content-Encoding: nonce\x00", 12)
        평문 = AESGCM(cek).decrypt(nonce, 암호문, None)
        assert 평문.endswith(b"\x02"), "마지막 레코드 구분자"
        return 평문[:-1]


# ── 암호화 ────────────────────────────────────────────────────
class Test암호화:
    def test_RFC_8291_부록_A_와_바이트까지_같다(self):
        서버 = W.열쇠_읽기("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
        assert W.공개키(서버) == ("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8")
        몸 = W.암호화(b"When I grow up, I want to be a watermelon",
                    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
                    "BTBZMqHH6r4Tts7J_aSIgg", 소금=W.unb64u("DGv6ra1nlYgDCS1FRnbzlw"), 서버키=서버)
        assert W.b64u(몸) == (
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6Tlz"
            "AC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")

    def test_받는_쪽이_풀면_원래_글이다_한글도(self):
        d = 기기()
        글 = json.dumps({"title": "가격 알림", "body": "에코프로 10만원 넘음"}, ensure_ascii=False).encode()
        assert d.풀기(W.암호화(글, d.p256dh, d.auth_글)) == 글

    def test_메시지마다_소금과_서버키가_새것이다(self):
        """같은 열쇠를 두 번 쓰면 암호가 깨진다"""
        d = 기기()
        a, b = W.암호화(b"x", d.p256dh, d.auth_글), W.암호화(b"x", d.p256dh, d.auth_글)
        assert a[:16] != b[:16] and a[21:86] != b[21:86]

    def test_너무_긴_본문은_거절(self):
        d = 기기()
        W.암호화(b"a" * W.본문_한도, d.p256dh, d.auth_글)
        with pytest.raises(ValueError):
            W.암호화(b"a" * (W.본문_한도 + 1), d.p256dh, d.auth_글)


# ── VAPID ─────────────────────────────────────────────────────
class TestVAPID:
    def _나눠(self, 머리: str):
        assert 머리.startswith("vapid t=") and ", k=" in 머리
        t, k = 머리[len("vapid t="):].split(", k=")
        h, c, s = t.split(".")
        return json.loads(W.unb64u(h)), json.loads(W.unb64u(c)), (h + "." + c).encode(), W.unb64u(s), k

    def test_서명이_공개키로_검증된다(self):
        키 = W.새_열쇠()
        머리, 몸, 서명할것, 서명, k = self._나눠(
            W.vapid_머리("https://fcm.googleapis.com/fcm/send/abc?x=1", 키, "https://앱.example", 지금=1_000_000))
        assert 머리 == {"typ": "JWT", "alg": "ES256"}
        assert 몸 == {"aud": "https://fcm.googleapis.com", "exp": 1_000_000 + 12 * 3600, "sub": "https://앱.example"}
        assert k == W.공개키(키) and len(서명) == 64
        공개 = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), W.unb64u(k))
        der = encode_dss_signature(int.from_bytes(서명[:32], "big"), int.from_bytes(서명[32:], "big"))
        공개.verify(der, 서명할것, ec.ECDSA(hashes.SHA256()))
        with pytest.raises(InvalidSignature):
            공개.verify(der, 서명할것 + b"x", ec.ECDSA(hashes.SHA256()))

    def test_서명_수명은_24시간을_안_넘는다(self):
        assert W.서명_수명 <= 24 * 3600
        _, 몸, *_ = self._나눠(W.vapid_머리("https://web.push.apple.com/abc", W.새_열쇠(), "https://a"))
        assert time.time() < 몸["exp"] <= time.time() + 24 * 3600
        assert 몸["aud"] == "https://web.push.apple.com"

    def test_열쇠는_PEM_과_32바이트_글_둘_다_읽는다(self):
        키 = W.새_열쇠()
        assert W.공개키(W.열쇠_읽기(W.열쇠_글(키))) == W.공개키(키)
        날 = 키.private_numbers().private_value.to_bytes(32, "big")
        assert W.공개키(W.열쇠_읽기(W.b64u(날))) == W.공개키(키)
        assert len(W.unb64u(W.공개키(키))) == 65 and W.unb64u(W.공개키(키))[0] == 4

    def test_다른_곡선이나_길이가_틀린_열쇠는_거절(self):
        다른 = ec.generate_private_key(ec.SECP384R1()).private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        with pytest.raises(ValueError):
            W.열쇠_읽기(다른)
        with pytest.raises(ValueError):
            W.열쇠_읽기(W.b64u(b"\x01" * 31))


# ── 끝점 ──────────────────────────────────────────────────────
class Test끝점:
    @pytest.mark.parametrize("주소", [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
        "https://web.push.apple.com/QGabc",
        "https://android.googleapis.com/gcm/send/abc",
    ])
    def test_알려진_푸시_서버는_받는다(self, 주소):
        assert P.받는_끝점인가(주소)

    @pytest.mark.parametrize("주소", [
        "http://fcm.googleapis.com/fcm/send/abc",           # https 가 아니다
        "https://fcm.googleapis.com.evil.com/x",            # 뒤에 붙여 속이기
        "https://evilfcm.googleapis.com.example/x",
        "https://notpush.apple.com.example/x",
        "https://evilfcm.googleapis.com/x",                 # 점 없이 이어 붙인 이름
        "https://169.254.169.254/latest/meta-data",         # 클라우드 정보 주소
        "https://localhost/x",
        "fcm.googleapis.com/x",
        "",
    ])
    def test_다른_주소는_막는다(self, 주소):
        assert not P.받는_끝점인가(주소)


# ── DB 가 드는 것 ─────────────────────────────────────────────
@pytest.fixture
def 메모리DB(monkeypatch):
    import importlib
    import pkgutil
    import app.db.database as D
    import app.models as 모델들
    from app.db.database import Base
    for 칸 in pkgutil.iter_modules(모델들.__path__):
        importlib.import_module(f"app.models.{칸.name}")
    엔진 = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(엔진)
    세션 = sessionmaker(bind=엔진)
    monkeypatch.setattr(D, "SessionLocal", 세션)
    monkeypatch.setattr(P, "_열쇠", None)
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    return 세션


@pytest.fixture
def 바로(monkeypatch):
    """뒤에서 보내는 일꾼을 그 자리에서 돌린다"""
    class 그자리:
        def submit(self, f, *a):
            return f(*a)
    monkeypatch.setattr(P, "_일꾼", 그자리())


@pytest.fixture
def 푸시서버(monkeypatch):
    """푸시 서버 흉내 — 받은 요청을 남기고, 끝점마다 정한 상태로 답한다"""
    받은: list = []
    답 = {}

    def 처리(req: httpx.Request):
        받은.append(req)
        상태 = 답.get(str(req.url), 201)
        if isinstance(상태, Exception):
            raise 상태
        return httpx.Response(상태)

    원래 = httpx.Client
    monkeypatch.setattr(P.httpx, "Client", lambda **k: 원래(transport=httpx.MockTransport(처리)))
    return 받은, 답


def _사람(세션, 이름="가", 별명=None):
    from app.models.user import User
    from app.models.community import UserProfile
    db = 세션()
    u = User(username=이름, hashed_password="x")
    db.add(u); db.commit()
    if 별명:
        db.add(UserProfile(user_id=u.id, nickname=별명)); db.commit()
    uid = u.id
    db.close()
    return uid


class Test열쇠:
    def test_환경변수가_먼저(self, 메모리DB, monkeypatch):
        키 = W.새_열쇠()
        monkeypatch.setenv("VAPID_PRIVATE_KEY", W.열쇠_글(키))
        assert P.공개키() == W.공개키(키)
        from app.models.push import PushKey
        assert 메모리DB().query(PushKey).count() == 0, "환경변수가 있으면 DB 에 안 만든다"

    def test_없으면_한_번_만들어_DB_에_두고_다시_뜬_뒤에도_같은_것(self, 메모리DB, monkeypatch):
        첫 = P.공개키()
        from app.models.push import PushKey
        assert 메모리DB().query(PushKey).count() == 1
        monkeypatch.setattr(P, "_열쇠", None)                 # 서버가 다시 떴다
        assert P.공개키() == 첫, "열쇠가 바뀌면 그동안의 구독이 모두 못 쓰게 된다"
        assert 메모리DB().query(PushKey).count() == 1

    def test_줄이_둘이면_먼저_만든_것(self, 메모리DB):
        from app.models.push import PushKey
        a, b = W.새_열쇠(), W.새_열쇠()
        db = 메모리DB()
        db.add_all([PushKey(private_pem=W.열쇠_글(a)), PushKey(private_pem=W.열쇠_글(b))]); db.commit()
        assert P.공개키() == W.공개키(a)


class Test구독:
    def test_켜고_다시_켜면_고친다_같은_기기를_다른_계정이_켜면_주인이_바뀐다(self, 메모리DB):
        from app.models.push import PushSubscription
        가, 나 = _사람(메모리DB, "가"), _사람(메모리DB, "나")
        d = 기기()
        db = 메모리DB()
        P.구독하기(db, 가, d.endpoint, d.p256dh, d.auth_글, ipo=False, 증권사=["키움증권"])
        줄 = db.query(PushSubscription).one()
        assert (줄.user_id, 줄.ipo, 줄.brokers) == (가, False, "키움증권")
        줄.fail_count = 3; db.commit()
        P.구독하기(db, 나, d.endpoint, d.p256dh, d.auth_글)
        줄 = db.query(PushSubscription).one()
        assert (줄.user_id, 줄.ipo, 줄.brokers, 줄.fail_count) == (나, True, None, 0)

    def test_끄기는_내_기기만(self, 메모리DB):
        from app.models.push import PushSubscription
        가, 나 = _사람(메모리DB, "가"), _사람(메모리DB, "나")
        d = 기기()
        db = 메모리DB()
        P.구독하기(db, 가, d.endpoint, d.p256dh, d.auth_글)
        assert P.해지하기(db, 나, d.endpoint) is False
        assert db.query(PushSubscription).count() == 1
        assert P.해지하기(db, 가, d.endpoint) is True
        assert db.query(PushSubscription).count() == 0


class Test내용:
    def _알림(self, 세션, **k):
        from app.models.community import Notification
        db = 세션()
        n = Notification(**k)
        db.add(n); db.commit(); db.refresh(n)
        db.expunge(n)
        db.close()
        return n

    def test_가격_알림은_그_종목으로(self, 메모리DB):
        uid = _사람(메모리DB)
        n = self._알림(메모리DB, user_id=uid, kind="price_alert", symbol="086520", market="KR",
                       preview="에코프로 100,000원 넘음 — 지금 101,500원")
        c = P.알림_내용(메모리DB(), n)
        assert c == {"title": "가격 알림", "body": "에코프로 100,000원 넘음 — 지금 101,500원",
                     "url": "/stocks/KR/086520", "tag": "price-086520"}

    def test_사람이_한_일은_별명으로_알림_목록과_같은_말(self, 메모리DB):
        받는이, 보낸이 = _사람(메모리DB, "받는이"), _사람(메모리DB, "보낸이", 별명="개미왕")
        n = self._알림(메모리DB, user_id=받는이, actor_id=보낸이, kind="comment", post_id=7, preview="좋은 글이네요")
        c = P.알림_내용(메모리DB(), n)
        assert c["title"] == "개미왕님이 회원님의 글에 댓글을 남겼습니다"
        assert (c["body"], c["url"]) == ("좋은 글이네요", "/post/7")

    def test_팔로우는_그_사람_프로필로_별명이_없으면_아이디(self, 메모리DB):
        받는이, 보낸이 = _사람(메모리DB, "받는이"), _사람(메모리DB, "ant99")
        n = self._알림(메모리DB, user_id=받는이, actor_id=보낸이, kind="follow")
        c = P.알림_내용(메모리DB(), n)
        assert c["title"] == "ant99님이 회원님을 팔로우했습니다" and c["url"] == f"/profile/{보낸이}"

    def test_글이_없는_알림은_알림_목록으로(self, 메모리DB):
        받는이 = _사람(메모리DB, "받는이")
        n = self._알림(메모리DB, user_id=받는이, actor_id=None, kind="reply")
        c = P.알림_내용(메모리DB(), n)
        assert c["url"] == "/notifications" and c["title"].startswith("누군가님이")


class Test보내기:
    def _구독(self, 세션, uid, d):
        db = 세션()
        P.구독하기(db, uid, d.endpoint, d.p256dh, d.auth_글)
        db.close()

    def test_암호화해서_머리를_붙여_보내고_휴대폰이_풀면_그_내용(self, 메모리DB, 푸시서버):
        from app.models.push import PushSubscription
        받은, _ = 푸시서버
        uid = _사람(메모리DB)
        d = 기기()
        self._구독(메모리DB, uid, d)
        db = 메모리DB()
        내용 = {"title": "가격 알림", "body": "삼성전자 8만원", "url": "/stocks/KR/005930", "tag": "t"}
        assert P.기기들에(db, db.query(PushSubscription).all(), 내용, "price_alert") == 1
        req = 받은[0]
        assert str(req.url) == d.endpoint and req.method == "POST"
        assert req.headers["Content-Encoding"] == "aes128gcm"
        assert req.headers["TTL"] == "3600" and req.headers["Urgency"] == "high"
        assert req.headers["Authorization"].startswith("vapid t=")
        assert f"k={P.공개키()}" in req.headers["Authorization"]
        assert json.loads(d.풀기(req.content)) == 내용
        assert db.query(PushSubscription).one().last_ok_at is not None

    def test_다른_알림은_하루_보통_급함(self, 메모리DB, 푸시서버):
        from app.models.push import PushSubscription
        받은, _ = 푸시서버
        self._구독(메모리DB, _사람(메모리DB), 기기())
        db = 메모리DB()
        P.기기들에(db, db.query(PushSubscription).all(), {"title": "x"}, "comment")
        assert 받은[0].headers["TTL"] == str(24 * 3600) and 받은[0].headers["Urgency"] == "normal"

    def test_없는_구독이라고_하면_지운다(self, 메모리DB, 푸시서버):
        from app.models.push import PushSubscription
        _, 답 = 푸시서버
        uid = _사람(메모리DB)
        살, 죽 = 기기("https://fcm.googleapis.com/fcm/send/live"), 기기("https://fcm.googleapis.com/fcm/send/gone")
        self._구독(메모리DB, uid, 살); self._구독(메모리DB, uid, 죽)
        답[죽.endpoint] = 410
        db = 메모리DB()
        assert P.기기들에(db, db.query(PushSubscription).all(), {"title": "x"}, "comment") == 1
        assert [s.endpoint for s in db.query(PushSubscription).all()] == [살.endpoint]

    def test_실패가_쌓이면_지우고_한_번_되면_다시_센다(self, 메모리DB, 푸시서버):
        from app.models.push import PushSubscription
        _, 답 = 푸시서버
        d = 기기()
        self._구독(메모리DB, _사람(메모리DB), d)
        db = 메모리DB()
        답[d.endpoint] = 500
        for i in range(P.실패_한도 - 1):
            P.기기들에(db, db.query(PushSubscription).all(), {"title": "x"}, "comment")
        assert db.query(PushSubscription).one().fail_count == P.실패_한도 - 1
        답[d.endpoint] = httpx.ConnectError("끊김")              # 연결이 안 돼도 실패로 센다
        P.기기들에(db, db.query(PushSubscription).all(), {"title": "x"}, "comment")
        assert db.query(PushSubscription).count() == 0

    def test_한_번_되면_실패_수를_지운다(self, 메모리DB, 푸시서버):
        from app.models.push import PushSubscription
        _, 답 = 푸시서버
        d = 기기()
        self._구독(메모리DB, _사람(메모리DB), d)
        db = 메모리DB()
        답[d.endpoint] = 500
        P.기기들에(db, db.query(PushSubscription).all(), {"title": "x"}, "comment")
        답[d.endpoint] = 201
        P.기기들에(db, db.query(PushSubscription).all(), {"title": "x"}, "comment")
        assert db.query(PushSubscription).one().fail_count == 0

    def test_알림은_받는_사람의_기기에만(self, 메모리DB, 푸시서버, 바로):
        from app.models.community import Notification
        받은, _ = 푸시서버
        가, 나 = _사람(메모리DB, "가"), _사람(메모리DB, "나")
        가폰, 나폰 = 기기("https://fcm.googleapis.com/fcm/send/ga"), 기기("https://fcm.googleapis.com/fcm/send/na")
        self._구독(메모리DB, 가, 가폰); self._구독(메모리DB, 나, 나폰)
        db = 메모리DB()
        n = Notification(user_id=가, kind="price_alert", symbol="AAPL", market="US", preview="애플 200달러")
        db.add(n); db.commit()
        P.알림_보내기([n.id, None])
        assert [str(r.url) for r in 받은] == [가폰.endpoint]
        assert json.loads(가폰.풀기(받은[0].content))["body"] == "애플 200달러"

    def test_보낼_알림이_없으면_일꾼을_안_부른다(self, monkeypatch):
        부름 = []
        class 기록:
            def submit(self, *a):
                부름.append(a)
        monkeypatch.setattr(P, "_일꾼", 기록())
        P.알림_보내기([None, 0])
        P.알림_보내기([])
        assert 부름 == []
        P.알림_보내기([None, 3])
        assert 부름 == [(P._알림들_보내기, [3])]

    def test_알림_보내기는_예외를_안_낸다(self, monkeypatch):
        class 닫힘:
            def submit(self, *a):
                raise RuntimeError("cannot schedule new futures after shutdown")
        monkeypatch.setattr(P, "_일꾼", 닫힘())
        P.알림_보내기([1])
        P.알림_보내기([])

    def test_시험_알림(self, 메모리DB, 푸시서버):
        받은, _ = 푸시서버
        uid = _사람(메모리DB)
        assert P.시험_보내기(메모리DB(), uid) == {"devices": 0, "sent": 0}
        d = 기기()
        self._구독(메모리DB, uid, d)
        assert P.시험_보내기(메모리DB(), uid) == {"devices": 1, "sent": 1}
        assert json.loads(d.풀기(받은[0].content))["title"] == "알림이 이렇게 와요"


# ── 알림이 생기는 곳에서 부른다 ──────────────────────────────────
class Test부르는_곳:
    def test_커뮤니티_알림은_커밋한_뒤에_푸시로(self, 메모리DB, monkeypatch):
        from app.api.routes import community as C
        from app.models.community import Notification
        불림 = []
        monkeypatch.setattr(P, "알림_보내기", lambda ids: 불림.append(list(ids)))
        가, 나 = _사람(메모리DB, "가"), _사람(메모리DB, "나")
        db = 메모리DB()
        C._notify(db, user_id=가, actor_id=나, kind="comment", post_id=None, preview="안녕")
        n = db.query(Notification).one()
        assert 불림 == [[n.id]]
        C._notify(db, user_id=가, actor_id=가, kind="comment")       # 내가 내 글에 — 알림도 푸시도 없다
        assert 불림 == [[n.id]]

    def test_끈_종류는_푸시도_없다(self, 메모리DB, monkeypatch):
        from app.api.routes import community as C
        from app.models.community import UserProfile
        불림 = []
        monkeypatch.setattr(P, "알림_보내기", lambda ids: 불림.append(ids))
        가, 나 = _사람(메모리DB, "가"), _사람(메모리DB, "나")
        db = 메모리DB()
        db.add(UserProfile(user_id=가, noti_disabled="follow")); db.commit()
        C._notify(db, user_id=가, actor_id=나, kind="follow")
        assert 불림 == []

    def test_알림이_못_남으면_푸시도_없다(self, monkeypatch):
        from app.api.routes import community as C
        불림 = []
        monkeypatch.setattr(P, "알림_보내기", lambda ids: 불림.append(ids))

        class 터지는DB:
            def query(self, *a, **k): raise RuntimeError("DB 끊김")
            def rollback(self): pass

        C._notify(터지는DB(), user_id=1, actor_id=2, kind="comment")
        assert 불림 == []

    def test_가격_알림이_울리면_푸시로(self, 메모리DB, monkeypatch):
        from app.core.cache import cache
        from app.models.stock import PriceAlert
        from app.models.community import Notification
        from app.services import alert_checker as A
        불림 = []
        monkeypatch.setattr(P, "알림_보내기", lambda ids: 불림.append(list(ids)))
        uid = _사람(메모리DB)
        db = 메모리DB()
        db.add(PriceAlert(user_id=uid, symbol="TSTPUSH", market="US", name="시험", direction="above", target=10))
        db.commit()
        cache.set("price:TSTPUSH", {"price": 11.0}, 60)
        try:
            assert A.확인하기() == 1
        finally:
            cache.delete("price:TSTPUSH")
        assert 불림 == [[메모리DB().query(Notification).one().id]]


# ── 주소 ──────────────────────────────────────────────────────
class Test주소:
    @pytest.fixture
    def 손님(self, 메모리DB, monkeypatch):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.deps import require_user
        from app.db.database import get_db
        uid = _사람(메모리DB, "주인")

        class 나:
            id = uid
        def db주기():
            db = 메모리DB()
            try:
                yield db
            finally:
                db.close()
        app.dependency_overrides[get_db] = db주기
        app.dependency_overrides[require_user] = lambda: 나()
        yield TestClient(app), uid
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(require_user, None)

    def _몸(self, d, **덮):
        return {"endpoint": d.endpoint, "keys": {"p256dh": d.p256dh, "auth": d.auth_글}, **덮}

    def test_공개키는_로그인_없이(self, 손님):
        c, _ = 손님
        r = c.get("/api/v1/push/key")
        assert r.status_code == 200 and len(W.unb64u(r.json()["public_key"])) == 65

    def test_켜기_끄기(self, 손님, 메모리DB):
        from app.models.push import PushSubscription
        c, uid = 손님
        d = 기기()
        r = c.post("/api/v1/push/subscribe", json=self._몸(d, ipo=True, brokers=[" 키움증권 ", "", "KB증권"]))
        assert r.status_code == 200 and r.json() == {"ok": True, "ipo": True, "brokers": ["키움증권", "KB증권"]}
        assert 메모리DB().query(PushSubscription).one().user_id == uid
        assert c.post("/api/v1/push/unsubscribe", json={"endpoint": d.endpoint}).json() == {"ok": True}
        assert 메모리DB().query(PushSubscription).count() == 0

    def test_푸시_서버가_아닌_주소는_422(self, 손님):
        c, _ = 손님
        d = 기기("https://169.254.169.254/latest/meta-data")
        assert c.post("/api/v1/push/subscribe", json=self._몸(d)).status_code == 422

    def test_열쇠_모양이_틀리면_422(self, 손님):
        c, _ = 손님
        d = 기기()
        assert c.post("/api/v1/push/subscribe",
                      json={"endpoint": d.endpoint, "keys": {"p256dh": "짧다", "auth": d.auth_글}}).status_code == 422

    def test_기기가_없으면_시험_알림은_404(self, 손님):
        c, _ = 손님
        assert c.post("/api/v1/push/test").status_code == 404

    def test_로그인해야_켠다(self):
        from fastapi.testclient import TestClient
        from app.main import app
        d = 기기()
        r = TestClient(app).post("/api/v1/push/subscribe", json=self._몸(d))
        assert r.status_code in (401, 403)


# ── 공모주 청약 아침 알림 ──────────────────────────────────────
class Test공모주_아침:
    기록 = {
        1: {"name": "가나바이오", "sub_start": "2026-11-02", "sub_end": "2026-11-03", "underwriter": "KB증권"},
        2: {"name": "다라테크", "sub_start": "2026-11-03", "sub_end": "2026-11-04", "underwriter": "미래에셋대우(대표)"},
        3: {"name": "마바로보", "sub_start": "2026-11-10", "sub_end": "2026-11-11", "underwriter": "키움증권"},
        4: {"name": "수요예측만", "forecast_date": "2026-11-03"},
    }

    def test_오늘_시작하거나_마감하는_것(self):
        assert [r["name"] for r in P.오늘_청약(self.기록, date(2026, 11, 3))] == ["가나바이오", "다라테크"]
        assert P.오늘_청약(self.기록, date(2026, 11, 5)) == []

    def test_글에_마감과_주관사(self):
        c = P.아침_글(P.오늘_청약(self.기록, date(2026, 11, 3)), date(2026, 11, 3))
        assert c["title"] == "오늘 공모주 청약 2곳"
        assert c["body"] == "가나바이오 마감(KB증권), 다라테크(미래에셋증권)"
        assert (c["url"], c["tag"]) == ("/ipo", "ipo-2026-11-03")

    def test_켠_기기에_고른_증권사_것만(self, 메모리DB, 푸시서버, monkeypatch):
        from app.services import ipo_service
        받은, _ = 푸시서버
        monkeypatch.setattr(ipo_service, "기록들", lambda: self.기록)
        uid = _사람(메모리DB)
        모두, 키움, KB, 끔 = (기기(f"https://fcm.googleapis.com/fcm/send/{x}") for x in ("all", "kiwoom", "kb", "off"))
        db = 메모리DB()
        P.구독하기(db, uid, 모두.endpoint, 모두.p256dh, 모두.auth_글)
        P.구독하기(db, uid, 키움.endpoint, 키움.p256dh, 키움.auth_글, 증권사=["키움증권"])
        P.구독하기(db, uid, KB.endpoint, KB.p256dh, KB.auth_글, 증권사=["KB증권"])
        P.구독하기(db, uid, 끔.endpoint, 끔.p256dh, 끔.auth_글, ipo=False)
        assert P.공모주_아침(date(2026, 11, 3)) == 2
        간곳 = {str(r.url): r for r in 받은}
        assert set(간곳) == {모두.endpoint, KB.endpoint}, "키움은 오늘 없고, 끈 기기에는 안 간다"
        assert json.loads(KB.풀기(간곳[KB.endpoint].content))["body"] == "가나바이오 마감(KB증권)"
        assert "다라테크" in json.loads(모두.풀기(간곳[모두.endpoint].content))["body"]

    def test_오늘_청약이_없으면_DB_도_안_본다(self, monkeypatch):
        from app.services import ipo_service
        monkeypatch.setattr(ipo_service, "기록들", lambda: self.기록)
        import app.db.database as D
        monkeypatch.setattr(D, "SessionLocal", lambda: pytest.fail("청약이 없는데 DB 를 봤다"))
        assert P.공모주_아침(date(2026, 11, 20)) == 0

    def test_평일_아침_그_사이에_하루_한_번(self, monkeypatch):
        보냄 = []
        monkeypatch.setattr(P, "공모주_아침", lambda d: 보냄.append(d) or 1)
        monkeypatch.setattr(P, "_아침_보낸날", None)
        한국 = lambda *a: datetime(*a, tzinfo=timezone.utc) - __import__("datetime").timedelta(hours=9)
        assert P.아침_챙기기(한국(2026, 11, 3, 8, 39)) == 0           # 이르다
        assert P.아침_챙기기(한국(2026, 11, 3, 8, 40)) == 1
        assert P.아침_챙기기(한국(2026, 11, 3, 9, 0)) == 0            # 오늘 이미
        assert P.아침_챙기기(한국(2026, 11, 3, 10, 0)) == 0
        assert P.아침_챙기기(한국(2026, 11, 4, 9, 59)) == 1           # 다음 날
        assert P.아침_챙기기(한국(2026, 11, 7, 9, 0)) == 0            # 토요일
        assert 보냄 == [date(2026, 11, 3), date(2026, 11, 4)]

    def test_주기_갱신이_아침_알림을_살핀다(self):
        import inspect
        from app.services import scheduler as S
        assert "push_service.아침_챙기기" in inspect.getsource(S.periodic_refresh)
