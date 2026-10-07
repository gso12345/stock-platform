"""외부 호출(네이버·야후·KIS·뉴스 피드…)이 함께 쓰는 SSL 설정.

httpx 는 클라이언트를 만들 때마다(httpx.get 도 속으로 하나 만든다) 인증서
묶음(certifi, 270KB)을 처음부터 다시 읽어 SSL 설정을 새로 짓는다. 한 번에
25~30ms 인데, 0.15 CPU 에서 재 보니 한 번에 0.2초(최대 0.4초)였다.
`async def` 안에서 만들면 그동안 이벤트 루프가 멈춰서, 그 순간 들어온
다른 사람의 요청까지 같이 선다.

이런 곳이 서른여덟 군데였고, 서버가 깨어난 뒤 10초 동안만 130번 넘게
지었다. 공유 설정으로 바꿔 0.15 CPU 에서 재 보니 깨어난 뒤 첫 응답이
43초 → 24초로 줄었다.

그래서 한 번만 짓고 모두 `verify=SSL` 로 이것을 넘겨받는다.

· httpx.create_ssl_context() 로 짓는다 — 지금까지와 똑같이 SSL_CERT_FILE·
  SSL_CERT_DIR 환경변수를 따른다. ssl.create_default_context(certifi) 를
  직접 부르면 그 둘을 조용히 무시하게 된다.
· 여러 스레드가 같이 읽어도 안전하다. 다만 httpcore 가 연결마다
  set_alpn_protocols 로 이 설정을 고쳐 쓴다 — 모두 http/1.1 이라 늘 같은
  값을 쓰므로 괜찮지만, 어디선가 http2=True 를 켜면 그 클라이언트에는
  이것을 넘기지 말 것.
· 클라이언트 자체를 공유하지는 않는다. 테스트들이 httpx.get·AsyncClient 를
  가짜로 갈아 끼우는데, 미리 만들어 둔 클라이언트는 그걸 비켜 간다.
"""
import httpx

SSL = httpx.create_ssl_context()
