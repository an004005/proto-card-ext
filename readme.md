# Card Extraction

카드 전투와 절차적 시설 침투를 결합한 익스트랙션 로그라이트 프로토타입이다.

- [프로젝트 문서](./docs/README.md)
- [데이터 위치와 문서 관리 규칙](./CONTEXT.md)
- [실행 중인 데모](https://an004005.github.io/proto-card-ext/)

## 명령

의존성을 설치한 뒤 로컬 서버를 실행한다.

```powershell
npm install
npx --yes serve .
```

브라우저에서 `http://localhost:3000`을 열면 게임을 실행할 수 있다.

테스트와 문서 동기화 명령:

```powershell
npm test
npm run docs:reference
npm run docs:check
```

`docs:reference`는 현재 코드 데이터에서 `docs/card-extraction-reference.xlsx`를 다시 만든다.
