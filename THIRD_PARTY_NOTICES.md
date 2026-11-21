# 크레딧 · 라이선스

## 이 게임이 직접 만든 것
- **3D 모델·맵**: 닭, 마을, 건물, 나무, 소품은 모두 코드로 만든 도형(상자, 원기둥, 구 등)을 조합했다(`client/chickens.js`, `client/world.js`). 외부 모델 파일이 없다.
- **그림**: 연기 구름, 깃털, 표시 아이콘은 캔버스에 코드로 그리고(`client/fx.js`), 버튼 아이콘과 앱 아이콘은 직접 쓴 SVG 다.
- **소리**: Web Audio API 로 실시간 합성한다(`client/audio.js`). 음원 파일이 없다.

## 사용한 오픈소스
| 이름 | 버전 | 쓰는 곳 | 라이선스 | 저작권 |
|---|---|---|---|---|
| three.js | r170 | 브라우저 3D 렌더링 (`vendor/three`) | MIT | Copyright © 2010-2024 three.js authors |
| ws | 8.x | 게임 서버의 WebSocket | MIT | Copyright (c) 2011 Einar Otto Stangvik, (c) 2013 Arnout Kazemier and contributors, (c) 2016 Luigi Pinca and contributors |
| Jua (글꼴) | — | 제목·버튼 글꼴 (Google Fonts 에서 불러온다, 배포하지 않음) | SIL Open Font License 1.1 | Copyright (c) Woowahan Brothers |

배포하는 three.js 파일은 첫 줄에 저작권·라이선스 표시가 그대로 들어 있고, 원문은 `vendor/three/LICENSE` 에 함께 둔다.

### MIT License
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
