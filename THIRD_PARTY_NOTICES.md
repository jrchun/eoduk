# 외부 코드 출처 표시 (Third-party notices)

이 저장소에는 아래 외부 코드가 그대로 들어 있습니다. 각 라이선스에 따라 출처와 라이선스 전문을 적습니다.

## 서울 행정구역 경계 (지도 데이터)

- 파일: `data/geo/gu.json`(구 경계), `data/geo/dong.json`(동 경계). 시범 전선 6개 구만 남겼다. 이것으로 만든 헥스 지도가 `web/data/map.json`·`supabase/seed.sql`
- 원자료: 통계청(KOSTAT) 센서스용 행정구역경계, 2013
- 받은 곳: https://github.com/southkorea/seoul-maps (`kostat/2013/json/seoul_municipalities_geo_simple.json`, `seoul_submunicipalities_geo_simple.json`). 저장소에 별도 라이선스 표기는 없다
- 일출·일몰 계산식은 suncalc(BSD-2, Vladimir Agafonkin)와 같은 천문 식을 직접 옮겨 썼다(코드를 복사하지 않음)

## @supabase/supabase-js 2.119.0

- 파일: `examples/supabase/web/vendor-supabase.js` (Supabase 모드로 바꾸면 `web/vendor-supabase.js`로 복사됨)
- 원본: npm 패키지 `@supabase/supabase-js@2.119.0`의 `dist/umd/supabase.js`, 수정 없음(맨 위 출처 주석 한 줄만 추가)
- 저장소: https://github.com/supabase/supabase-js
- 라이선스: MIT

```
MIT License

Copyright (c) 2020 Supabase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
