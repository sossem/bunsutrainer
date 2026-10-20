# 수학트레이너 통합 작업

## 분석 및 결정

작업 기준은 redesign 브랜치 8ac07cc의 분수 서비스다. 현재 체크아웃에는 소수 구현이 없었다. 별도 백업은 사용하지 말라는 사용자 지시에 따라 소수 엔진을 새로 작성했다. 분수 엔진을 소수 엔진으로 바꾸거나 백업 파일을 복사하지 않았다.

| 화면/기능 | 기존 분수 | 새 소수 및 공통화 |
|---|---|---|
| 진입 | 분수 홈 | 수학트레이너 홈에서 영역 선택, 같은 문서 내 이동 |
| 학년/단원/유형/설정 | app.js 카드·선택 UI | 동일 함수, 영역별 curriculum 데이터 |
| 문제/입력 | ui.js 분수 표시, 분자/분모 | 같은 문제 카드, 소수 모형·키패드·복수 입력 adapter |
| 타이머/교사 조작 | timer.js, session-extras.js | 동일 인스턴스 수명 관리와 조작 함수 |
| 점수/콤보/피드백/결과 | gamification.js, app.js | 동일 함수·CSS, 소수 개념 문제는 속도 경쟁 제한 |
| 로그인/학급 | competition.js, ranking.js | 한 메모리 로그인과 한 학급 선택 |
| 랭킹 | 주간 scoreVersion 3 | 같은 repository/provider, trainerId로 저장·조회 경로 선택 |
| 전자칠판/연습장 | classroom.css, scratchpad.js | 그대로 공유 |
| 기록/오답 | storage.js | 공통 기록 화면, 별도 소수 저장 adapter |

기존 app.js는 문서 단위 위임 이벤트와 메모리 세션으로 화면을 전환한다. fraction.js의 연산·판정, problem-generator.js의 생성, ui.js의 분수 표시를 수정하지 않았다. timer.js와 scratchpad.js, 기존 CSS도 수정하지 않았다. 신규 CSS는 플랫폼과 소수 고유 모형/입력에 한정한다.

## 인증과 Firebase

현재 코드는 Firebase Authentication을 사용하지 않는다. UID, 익명 Auth, 아이디/비밀번호 Auth listener가 없다. 기존 방식은 주간 닉네임과 숫자 6자리 비밀번호를 PBKDF2로 확인하고 메모리에 입장 상태를 유지한다. 이 동작을 플랫폼 인증으로 재사용하며 새 Auth 시스템을 도입하지 않았다.

ranking.js의 지연 초기화 Firebase compat App `fraction-class-ranking`과 캐시된 Firestore provider 하나를 양쪽에서 사용한다. 소수 코드에 별도 Firebase 초기화는 없다. 같은 페이지에서 영역을 이동할 때 로그인과 학급은 유지되고, 로그아웃은 공통으로 적용된다. 새로고침 이후에는 기존 정책대로 비밀번호 확인이 필요하다. 비밀번호를 localStorage/sessionStorage에 저장하지 않는다.

운영 컬렉션의 실제 문서를 읽거나 쓰지 않았다. 아래 구조와 버전은 저장소 코드에 근거하며, 배포된 보안 규칙·실제 문서 버전은 확인하지 못했다. 기존 인증/점수 검증이 클라이언트에 있으므로 서버가 신뢰할 수 있는 인증·점수 검증을 제공한다고 주장하지 않는다. 규칙을 완화하거나 배포하지 않았다.

## 영역별 랭킹과 저장 호환

| 용도 | 분수 | 소수 |
|---|---|---|
| 학급 | weeklyCompetitionClasses_주ID | decimalWeeklyCompetitionClasses_주ID |
| 개인 | weeklyCompetitionPlayers_주ID | decimalWeeklyCompetitionPlayers_주ID |
| 멱등 영수증 | weeklyCompetitionReceipts_주ID | decimalWeeklyCompetitionReceipts_주ID |
| 로컬 기록 | bunsu.learning.v1 | sosu.learning.v1 |

공통 닉네임 등록/검증은 기존 분수 players 경로를 유지한다. 소수의 첫 완료 시 같은 playerId와 platformPlayerId를 갖는 소수 점수 행을 만든다. 기존 소수 행이 있으면 같은 닉네임만으로 합치지 않는다. 연결된 ID 또는 기존 비밀번호 검증이 실패하면 원본을 보존하고 반영 실패를 표시한다.

classRankings_*, classGrowthRankings_* 구방식은 새 점수 경로로 활성화하지 않는다. 기존 분수 과거 기록 화면만 유지하며 소수 탭에서 분수 과거 랭킹을 표시하지 않는다. 주간 경계는 기존 월요일 08:00 KST이며 scoreVersion 3을 유지한다. 이전 scoreVersion 2 수용 범위도 유지한다.

새 기록은 trainerId를 명시한다. 없는 기존 분수 기록은 fraction으로 해석하며 일괄 변환하지 않는다. 기존 bunsu.game.v1, bunsu.class.v1, bunsu.ranking.v1 및 competition identity/drafts 키를 바꾸지 않는다. 알 수 없는 소수 저장 형식은 덮어쓰지 않고 메모리 저장 상태를 안내한다. 구형 소수 기록은 원본을 보존하고 표시 제한을 안내한다.

## 새 소수 엔진

기존 화면과 독립된 정확 계산·문제 데이터 모듈을 작성했다. BigInt 정수 계수/scale을 이용하며 JSON 경계에서는 문자열이다. 49개 ID: 3학년 6개, 4학년 14개, 5학년 핵심 10개, 6학년 핵심 14개, 연결 5개. 메타데이터는 앱용 재구성이며 공식 교육과정 유형 목록이라고 주장하지 않는다. 일부 나눗셈은 검증된 유한 템플릿 풀을 사용하므로 긴 세트에서 반복될 수 있다.

수치·비교·선택·순서화·분수·비·몫과 남는 양 입력, 3단계 힌트, 해설과 모형을 제공한다. 수치 동치와 지정 자리 표현을 구분한다. 소수 계산과 수치 비교는 랭킹 대상이며 비교는 속도 보너스가 없다. 그림·변환·순서화·연결 학습이 포함된 회차와 오답 복습·교실 공개 풀이는 랭킹에 넣지 않는다. 평균 도전은 소수 나눗셈 선수 학습을 명시적으로 선택해야 한다.

점수·콤보·보너스·완료 효과는 기존 LearningGame과 SessionExtras를 공유한다. 소수 단일 유형 기본 점수는 200점, 혼합 유형은 기존 공통 규칙을 따른다. 활성 분수 완료 흐름은 경험치/배지 지급을 하지 않고 expEarned=0, badgesEarned=[]로 기록하므로 이를 양쪽에 동일하게 유지했다. 기존 보상 모듈과 저장 데이터는 보존했다.

## 변경 파일

- index.html: 플랫폼 진입과 신규 모듈 로딩
- js/app.js: 공통 화면, 영역 adapter 전환, 공통 로그인 이동, 소수 입력
- js/platform.js: 플랫폼 영역 등록과 공통 세션/랭킹 facade
- js/trainer-adapters.js: 문제 표시/입력과 기록 저장의 영역 경계
- js/decimal-engine.js: 새 소수 유형과 정확 계산/채점
- css/platform.css: 플랫폼·소수 고유 모형 스타일
- js/competition.js, js/competition-ui.js: trainerId별 랭킹 저장·조회, 같은 로그인
- js/ranking.js: 플랫폼 설정에서 3학년 학급 허용
- js/session-extras.js, js/gamification.js: 공통 점수/타이머 연결, 기록 저장 영역 고정
- js/storage.js: 새 분수 기록의 trainerId 보존
- tests: 새 정확 계산/생성/저장/통합 검사, 의도된 플랫폼 홈과 재로그인 생략에 맞춘 기존 시나리오 진입 수정

## 실행 및 검증

프로젝트의 기존 정적 실행 방식을 사용한다. `python -m http.server 8000` 후 `http://localhost:8000`을 연다. `index.html` 직접 열기는 교실 학습에 사용할 수 있다. 온라인 로그인/랭킹은 인터넷과 적절한 Firestore 권한이 필요하다. `?trainer=fraction`, `?trainer=decimal`은 직접 진입용이며 영역 이동 버튼은 새 문서를 열지 않는다.

- `node --test tests/*.test.cjs`
- `python tests/scenarios.py`
- `python tests/competition_scenarios.py`
- `python tests/requested_changes_scenarios.py`
- `python tests/league_scenarios.py`
- `python tests/extension_scenarios.py`
- `python tests/ranking_scenarios.py`
- `python tests/platform_scenarios.py`
- `python tests/decimal_ui_scenarios.py`

브라우저 검사는 설치된 Chrome과 websocket-client를 사용한다. 이 환경에서는 `PYTHONPATH=tests/artifacts/python-deps`를 사용했다. 모든 온라인 쓰기는 테스트의 로컬 Firestore 모형에만 수행한다. 실제 DB 권한, 보안 규칙, 네트워크 연결 성공 및 배포는 검증/수행하지 않았다. 소수 컬렉션을 운영에 사용하기 전 해당 경로에 대한 규칙을 운영자 권한으로 확인해야 한다.

## 검증 결과

- Node 자동 테스트 235개 모두 통과.

- 기존 분수 브라우저 회귀 201개 / 화면 검사 134개 통과.
- 주간 경쟁 115개 / 화면 28개, 요청 기능 87개, 리그·비밀번호 초기화 35개, 도구 확장 56개 / 화면 16개, 과거 랭킹 25개 통과.
- 공통 로그인·영역 전환·학급 유지·분리 저장·랭킹 탭·로그아웃 등 플랫폼 검사 31개 통과.
- 소수 49유형 × 3난이도 × 80고정 seed 생성·정답 검사, 지정 정확 계산 사례 통과.
- 소수 49유형 실제 개인 입력 화면(360/768/1366/1920px)과 FHD 교사 힌트·정답·풀이 검사 통과. 콘솔 오류 없음.
- git diff에서 기존 분수 계산/생성/표시, 타이머·연습장, 기존 CSS 파일의 변경 없음 확인. 새 엔진과 플랫폼 연결, 관련 검증·문서만 변경.
