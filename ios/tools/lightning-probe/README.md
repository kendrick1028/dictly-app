# lightning-probe — Lightning 엔진 macOS 수치 검증 하네스

앱의 `Dictly/Services/Lightning/` 소스(디코더·프론트엔드·SafetensorsFetch)를 **원본 그대로**
macOS 에서 빌드해, mlx_whisper(MIT) 레퍼런스와 토큰·로짓 단위로 대조한다.
2026-08-22 M2 디버깅에서 mel-ANE 오염(폰 전용 증상)을 이 도구로 원인 확정했다.

## 빌드 (swift build 는 metallib 를 못 만든다 — 반드시 xcodebuild)
```bash
cp ../../Dictly/Services/Lightning/{WhisperMLXDecoder,CoreMLFrontend,SafetensorsFetch}.swift Sources/probe/
python3 make_ref_dumps.py            # 레퍼런스 덤프 생성 (README 상단 사용법 참조)
xcodebuild -scheme probe -configuration Release -destination 'platform=macOS,arch=arm64' -derivedDataPath dd build
```

## 모드
| 모드 | 검증 대상 |
|---|---|
| `probe . diff` | 디코더 수학 vs 레퍼런스 (토큰 일치 + 프리픽스 로짓 diff) |
| `probe . coreml` | 폰 파이프라인 재현: CoreML mel+인코더 → MLX 디코더 (~/Documents 에 626MB 변형 필요) |
| `probe . synthetic` | 결정적 합성 시퀀스 — 기기 커널 대조용 기대값 생성 |
| `probe . reassemble` | SafetensorsFetch 재조립 328MB 실다운로드 → 텐서 바이트 대조 |
| `probe . phone` | 기기 반출 텐서(phone-dump/*.bin — devicectl copy) 재검증 |
| `probe . melane` | mel 을 ANE 에 태워 오염 재현 (회귀 확인용) |

기기 텐서 반출: 앱 진단이 Documents/lightning-diag/*.bin 을 쓰던 시점의 빌드에서
`xcrun devicectl device copy from --domain-type appDataContainer --domain-identifier com.leehyunwoo.dictly --source Documents/lightning-diag/enc_final.bin ...`
