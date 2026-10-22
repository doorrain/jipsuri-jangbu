// 고정 선택지와 기본 설정. 가격·단가는 넣지 않습니다(견적 앱과 같은 원칙).

export const SOURCES = ['네이버', '당근', '소개', '검색', '업체 의뢰', '기타'];
export const STATUSES = ['문의', '예약확정', '작업완료', '정산완료', '취소'];
export const STATUS_CLASS = { 문의: 's-ask', 예약확정: 's-book', 작업완료: 's-done', 정산완료: 's-paid', 취소: 's-cancel' };
export const PAY_METHODS = ['계좌이체', '현금', '카드', '기타'];
export const BUY_METHODS = ['카드', '온라인결제', '현금', '계좌이체', '기타'];
export const BUY_CATS = ['현장 자재', '공구·장비', '소모품', '교육·기타 경비', '인건비'];
export const VAT_MODES = [
  { k: 'incl', label: '부가세 포함' },
  { k: 'none', label: '부가세 없음' },
  { k: 'excl', label: '부가세 별도' },
];
export const PHOTO_STAGES = ['문의', '작업 전', '작업 중', '작업 후', '후기', '기타'];
export const LABOR_TYPES = ['일용직', '외주(3.3%)', '기타'];
export const PAYERS = ['남편', '아내'];
export const REVIEW_WHERE = ['네이버', '당근', '문자', '기타'];

export const DEFAULT_SETTINGS = {
  workTags: [
    '문 수리', '문 교체', '중문', '도어락', '도어클로저', '방충망', '수전 교체', '세면대', '변기',
    '실리콘', '타일', '도배', '장판', '몰딩', '가구 조립', '커튼·블라인드', '전등·콘센트', '누수 점검',
  ],
  vendors: ['쿠팡', '네이버', 'G마켓', '다이소', '에이스하드웨어', '철물점'],
  banks: ['카카오뱅크', '토스뱅크', '국민', '신한', '우리', '하나', '농협', '기업', '네이버페이'],
  workers: [], // { name, phone, type }
  photoQuotaMB: 1024,
};
