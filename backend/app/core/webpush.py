"""웹 푸시 — 메시지 암호화(RFC 8291 · aes128gcm)와 보내는 서버 신분 증명(VAPID · RFC 8292).

브라우저(휴대폰)가 구독하면 푸시 서버 주소(endpoint)와 열쇠 둘(p256dh·auth)을 준다. 우리는
  1) 그 열쇠로 메시지를 암호화하고 — 푸시 서버(구글·애플·모질라)는 내용을 못 본다
  2) 우리 열쇠로 서명한 VAPID 머리를 붙여 그 주소로 POST 한다 — 아무나 못 보내게
브라우저가 받아 서비스워커(sw.js)의 push 로 넘기면 알림이 뜬다(앱이 닫혀 있어도).

pywebpush 를 안 쓰는 까닭 — 그것이 끌고 오는 http-ece 는 **휠이 없는** 꾸러미라 배포할 때마다
소스로 빌드해야 한다. requirements.txt 의 feedparser 이야기처럼, 빌드 도구가 바뀐 날 코드를 하나도
안 바꿨는데 배포가 통째로 깨진다. 두 규격은 짧고 cryptography(휠 있음) 하나로 된다. 맞게 짰는지는
RFC 8291 부록 A 의 예시 값으로 바이트 하나까지 맞춰 본다(test_웹푸시.py).
"""
from __future__ import annotations

import base64
import json
import os
import time
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

#: 레코드 크기(RFC 8188). 푸시 메시지는 한 레코드다 — 4KB 안에 들어가야 한다
레코드 = 4096
#: 암호화 전 본문 상한 — 레코드(4096)에서 머리(86)·구분자(1)·인증 꼬리표(16)를 빼고 넉넉히
본문_한도 = 3800
#: VAPID 서명이 살아 있는 시간 — 규격 상한은 24시간
서명_수명 = 12 * 3600


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _점(공개키: ec.EllipticCurvePublicKey) -> bytes:
    """공개키 → 65바이트(0x04 ‖ X ‖ Y)"""
    return 공개키.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def _hkdf(소금: bytes, 재료: bytes, 정보: bytes, 길이: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=길이, salt=소금, info=정보).derive(재료)


def 암호화(본문: bytes, p256dh: str, auth: str, *,
          소금: "bytes | None" = None, 서버키: "ec.EllipticCurvePrivateKey | None" = None) -> bytes:
    """aes128gcm 한 덩어리 — 머리(소금 16 ‖ 레코드 크기 4 ‖ 키 길이 1 ‖ 서버 공개키 65) + 암호문.

    소금·서버키는 RFC 예시로 맞춰 볼 때만 준다. 평소에는 메시지마다 새로 만든다 — 같은 열쇠를
    두 번 쓰면 암호가 깨진다."""
    if len(본문) > 본문_한도:
        raise ValueError(f"푸시 본문이 너무 길다({len(본문)}바이트)")
    받는쪽 = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64u(p256dh))
    서버키 = 서버키 or ec.generate_private_key(ec.SECP256R1())
    서버점, 받는점 = _점(서버키.public_key()), _점(받는쪽)
    소금 = 소금 or os.urandom(16)
    공유 = 서버키.exchange(ec.ECDH(), 받는쪽)
    ikm = _hkdf(unb64u(auth), 공유, b"WebPush: info\x00" + 받는점 + 서버점, 32)
    cek = _hkdf(소금, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(소금, ikm, b"Content-Encoding: nonce\x00", 12)
    # 마지막(이자 하나뿐인) 레코드는 0x02 로 끝낸다 — 채움 없이
    암호문 = AESGCM(cek).encrypt(nonce, 본문 + b"\x02", None)
    return 소금 + 레코드.to_bytes(4, "big") + bytes([len(서버점)]) + 서버점 + 암호문


# ── VAPID ─────────────────────────────────────────────────────
def 새_열쇠() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def 열쇠_글(키: ec.EllipticCurvePrivateKey) -> str:
    """보관용 — PEM(PKCS8)"""
    return 키.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                           serialization.NoEncryption()).decode()


def 열쇠_읽기(글: str) -> ec.EllipticCurvePrivateKey:
    """PEM 이나, web-push(npm)가 내는 32바이트 base64url 둘 다 읽는다(환경변수로 넣을 때)"""
    글 = 글.strip()
    if 글.startswith("-----BEGIN"):
        키 = serialization.load_pem_private_key(글.encode(), password=None)
        if not isinstance(키, ec.EllipticCurvePrivateKey) or 키.curve.name != "secp256r1":
            raise ValueError("VAPID 열쇠는 P-256 이어야 한다")
        return 키
    날 = unb64u(글)
    if len(날) != 32:
        raise ValueError("VAPID 열쇠 길이가 맞지 않다")
    return ec.derive_private_key(int.from_bytes(날, "big"), ec.SECP256R1())


def 공개키(키: ec.EllipticCurvePrivateKey) -> str:
    """브라우저가 구독할 때 쓰는 applicationServerKey — 65바이트 base64url"""
    return b64u(_점(키.public_key()))


def vapid_머리(끝점: str, 키: ec.EllipticCurvePrivateKey, 연락처: str, 지금: "float | None" = None) -> str:
    """Authorization 머리 — 'vapid t=<JWT>, k=<공개키>'. 받는 쪽(aud)은 끝점의 출처(scheme://host)"""
    u = urlsplit(끝점)
    def 조각(d: dict) -> str:
        return b64u(json.dumps(d, separators=(",", ":")).encode())
    서명할것 = (조각({"typ": "JWT", "alg": "ES256"}) + "." +
             조각({"aud": f"{u.scheme}://{u.netloc}", "exp": int((지금 or time.time()) + 서명_수명), "sub": 연락처}))
    # JWT 의 ES256 서명은 DER 이 아니라 r ‖ s(32바이트씩)다
    r, s = decode_dss_signature(키.sign(서명할것.encode(), ec.ECDSA(hashes.SHA256())))
    return f"vapid t={서명할것}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}, k={공개키(키)}"
