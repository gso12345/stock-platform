"""스크리닝의 국가·산업·업종 이름을 한국어로 — 사용자: "국가는 모두 한국어로", "산업도 모두 한국어로 표기해줘".

나스닥 분류(미국 전 종목)와 야후(주요 종목) 두 갈래의 영문 이름을 옮긴다. 나스닥 쪽은 나스닥 종목 목록
(nasdaq·nyse·amex 전 종목, 2026-10)에 실제로 나오는 국가 60곳·산업 152가지를 모두 담았고, 야후 쪽은 야후의
산업 분류(약 145가지) 전체다. 모르는 이름이 오면 영문 그대로 두고 한 번만 기록한다(관리자가 보고 더한다).

국내는 산업이 원래 한국어(한국표준산업분류 — GitHub 의 KRX 상세 목록)다. 업종(섹터)은 KRX 가 주는데 KRX 는
이제 로그인해야 자료를 준다 — 못 받으면 표준산업분류 이름으로 KRX 업종을 어림한다(국내업종_어림).
"""
from __future__ import annotations

import logging
import re

log = logging.getLogger(__name__)

나라_한글: dict[str, str] = {
    # 나스닥 종목 목록에 나오는 나라(많은 차례)
    "United States": "미국", "China": "중국", "Canada": "캐나다", "Israel": "이스라엘",
    "United Kingdom": "영국", "Singapore": "싱가포르", "Hong Kong": "홍콩", "Bermuda": "버뮤다",
    "Cayman Islands": "케이맨 제도", "Greece": "그리스", "Australia": "호주", "Japan": "일본",
    "Brazil": "브라질", "Switzerland": "스위스", "Taiwan": "대만", "Netherlands": "네덜란드",
    "Ireland": "아일랜드", "Luxembourg": "룩셈부르크", "France": "프랑스", "Mexico": "멕시코",
    "Malaysia": "말레이시아", "South Korea": "대한민국", "Germany": "독일", "Argentina": "아르헨티나",
    "United Arab Emirates": "아랍에미리트", "Sweden": "스웨덴", "India": "인도", "Chile": "칠레",
    "South Africa": "남아프리카공화국", "Belgium": "벨기에", "Denmark": "덴마크", "Italy": "이탈리아",
    "Jersey": "저지섬", "Cyprus": "키프로스", "Spain": "스페인", "Puerto Rico": "푸에르토리코",
    "Peru": "페루", "Monaco": "모나코", "British Virgin Islands": "영국령 버진아일랜드",
    "Uruguay": "우루과이", "Guernsey": "건지섬", "Macau": "마카오", "Finland": "핀란드",
    "Colombia": "콜롬비아", "Gibraltar": "지브롤터", "Kazakhstan": "카자흐스탄", "Turkey": "튀르키예",
    "Norway": "노르웨이", "Indonesia": "인도네시아", "Philippines": "필리핀", "Panama": "파나마",
    "New Zealand": "뉴질랜드", "Costa Rica": "코스타리카", "U.S. Virgin Islands": "미국령 버진아일랜드",
    "Cambodia": "캄보디아", "Jordan": "요르단", "Curacao": "퀴라소", "Bahamas": "바하마",
    "Isle of Man": "맨섬", "Marshall Islands": "마셜 제도",
    # 야후·다른 표기에서 나오는 나라
    "Korea": "대한민국", "Korea, Republic of": "대한민국", "Republic of Korea": "대한민국",
    "Taiwan, Province of China": "대만", "Macao": "마카오", "Russia": "러시아",
    "Russian Federation": "러시아", "Viet Nam": "베트남", "Vietnam": "베트남", "Thailand": "태국",
    "Austria": "오스트리아", "Portugal": "포르투갈", "Poland": "폴란드", "Czech Republic": "체코",
    "Czechia": "체코", "Hungary": "헝가리", "Iceland": "아이슬란드", "Malta": "몰타",
    "Liechtenstein": "리히텐슈타인", "Ukraine": "우크라이나", "Estonia": "에스토니아",
    "Latvia": "라트비아", "Lithuania": "리투아니아", "Romania": "루마니아", "Bulgaria": "불가리아",
    "Croatia": "크로아티아", "Serbia": "세르비아", "Slovenia": "슬로베니아", "Slovakia": "슬로바키아",
    "Georgia": "조지아", "Armenia": "아르메니아", "Azerbaijan": "아제르바이잔", "Mongolia": "몽골",
    "Saudi Arabia": "사우디아라비아", "Qatar": "카타르", "Kuwait": "쿠웨이트", "Bahrain": "바레인",
    "Oman": "오만", "Lebanon": "레바논", "Egypt": "이집트", "Morocco": "모로코", "Nigeria": "나이지리아",
    "Kenya": "케냐", "Ghana": "가나", "Zambia": "잠비아", "Botswana": "보츠와나", "Mauritius": "모리셔스",
    "Pakistan": "파키스탄", "Bangladesh": "방글라데시", "Sri Lanka": "스리랑카", "Ecuador": "에콰도르",
    "Venezuela": "베네수엘라", "Bolivia": "볼리비아", "Paraguay": "파라과이",
    "Dominican Republic": "도미니카공화국", "Guatemala": "과테말라", "Honduras": "온두라스",
    "El Salvador": "엘살바도르", "Jamaica": "자메이카", "Trinidad and Tobago": "트리니다드토바고",
    "Barbados": "바베이도스", "Belize": "벨리즈", "Anguilla": "앵귈라", "Aruba": "아루바",
    "Turks and Caicos Islands": "터크스 케이커스 제도", "Liberia": "라이베리아", "Uzbekistan": "우즈베키스탄",
    "Kyrgyzstan": "키르기스스탄", "Myanmar": "미얀마", "Brunei": "브루나이", "Papua New Guinea": "파푸아뉴기니",
    "Faroe Islands": "페로 제도", "Greenland": "그린란드", "Netherlands Antilles": "네덜란드령 안틸레스",
    "Channel Islands": "채널 제도", "Isle Of Man": "맨섬", "Senegal": "세네갈", "Tanzania": "탄자니아",
    "Namibia": "나미비아", "Zimbabwe": "짐바브웨", "Iraq": "이라크", "Nepal": "네팔", "Andorra": "안도라",
    "Montenegro": "몬테네그로", "North Macedonia": "북마케도니아", "Albania": "알바니아",
    "Bosnia and Herzegovina": "보스니아 헤르체고비나", "Moldova": "몰도바", "Belarus": "벨라루스",
    "Algeria": "알제리", "Tunisia": "튀니지", "Ivory Coast": "코트디부아르", "Côte d'Ivoire": "코트디부아르",
    "Angola": "앙골라", "Mozambique": "모잠비크", "Rwanda": "르완다", "Gabon": "가봉", "Guyana": "가이아나",
    "Suriname": "수리남", "Sint Maarten": "신트마르턴", "New Caledonia": "뉴칼레도니아", "Guam": "괌",
    "Fiji": "피지", "Samoa": "사모아", "Seychelles": "세이셸", "Maldives": "몰디브", "Haiti": "아이티",
    "Nicaragua": "니카라과", "Cuba": "쿠바", "Laos": "라오스", "Ethiopia": "에티오피아", "Uganda": "우간다",
    "Cameroon": "카메룬", "Tajikistan": "타지키스탄", "Turkmenistan": "투르크메니스탄", "Iran": "이란",
    "Syria": "시리아", "Yemen": "예멘", "Libya": "리비아", "Sudan": "수단", "San Marino": "산마리노",
}

#: 나스닥 분류의 산업(나스닥·NYSE·AMEX 전 종목에 실제로 나오는 152가지 + 표기만 다른 것)
_나스닥산업: dict[str, str] = {
    "Biotechnology: Pharmaceutical Preparations": "바이오: 의약품 제조",
    "Blank Checks": "스팩(기업인수목적회사)",
    "Major Banks": "대형 은행",
    "Computer Software: Prepackaged Software": "소프트웨어: 패키지 소프트웨어",
    "Industrial Machinery/Components": "산업용 기계·부품",
    "Real Estate Investment Trusts": "리츠(부동산투자신탁)",
    "Finance: Consumer Services": "금융: 소비자 금융",
    "EDP Services": "전산 처리 서비스",
    "Investment Managers": "자산운용사",
    "Biotechnology: Biological Products (No Diagnostic Substances)": "바이오: 생물학적 제제(진단 물질 제외)",
    "Medical/Dental Instruments": "의료·치과 기기",
    "Oil & Gas Production": "석유·가스 생산",
    "Semiconductors": "반도체",
    "Business Services": "사업 서비스",
    "Telecommunications Equipment": "통신 장비",
    "Trusts Except Educational Religious and Charitable": "신탁(교육·종교·자선 제외)",
    "Finance/Investors Services": "금융·투자자 서비스",
    "Computer Software: Programming Data Processing": "소프트웨어: 프로그래밍·데이터 처리",
    "Property-Casualty Insurers": "손해보험",
    "Electric Utilities: Central": "전력 유틸리티",
    "Other Consumer Services": "기타 소비자 서비스",
    "Marine Transportation": "해운",
    "Precious Metals": "귀금속",
    "Major Chemicals": "대형 화학",
    "Investment Bankers/Brokers/Service": "투자은행·증권 중개",
    "Finance Companies": "여신 금융",
    "Real Estate": "부동산",
    "Industrial Specialties": "산업 특수재",
    "Restaurants": "외식",
    "Professional Services": "전문 서비스",
    "Services-Misc. Amusement & Recreation": "오락·레저 서비스",
    "Metal Fabrications": "금속 가공",
    "Medical Specialities": "특수 의료",
    "Metal Mining": "금속 광업",
    "Packaged Foods": "가공식품",
    "Military/Government/Technical": "국방·정부·기술 서비스",
    "Other Specialty Stores": "기타 전문 소매",
    "Diversified Commercial Services": "종합 상업 서비스",
    "Auto Parts:O.E.M.": "자동차 부품(OEM)",
    "Beverages (Production/Distribution)": "음료(생산·유통)",
    "Hotels/Resorts": "호텔·리조트",
    "Commercial Banks": "상업은행",
    "Specialty Insurers": "특수 보험",
    "Electrical Products": "전기 제품",
    "Aerospace": "항공우주",
    "Savings Institutions": "저축 기관",
    "Medical/Nursing Services": "의료·간병 서비스",
    "Auto Manufacturing": "자동차 제조",
    "Farming/Seeds/Milling": "농업·종자·제분",
    "Homebuilding": "주택 건설",
    "Life Insurance": "생명보험",
    "Catalog/Specialty Distribution": "통신 판매·전문 유통",
    "Natural Gas Distribution": "천연가스 공급",
    "Apparel": "의류",
    "Power Generation": "발전",
    "Medicinal Chemicals and Botanical Products": "의약 화학·생약",
    "Steel/Iron Ore": "철강·철광석",
    "Biotechnology: Electromedical & Electrotherapeutic Apparatus": "바이오: 전기 의료·치료 기기",
    "Advertising": "광고",
    "Broadcasting": "방송",
    "Package Goods/Cosmetics": "생활용품·화장품",
    "Clothing/Shoe/Accessory Stores": "의류·신발·잡화 소매",
    "Mining & Quarrying of Nonmetallic Minerals (No Fuels)": "비금속 광물 채굴(연료 제외)",
    "Banks": "은행",
    "Biotechnology: Laboratory Analytical Instruments": "바이오: 실험·분석 기기",
    "Consumer Electronics/Appliances": "가전제품",
    "Transportation Services": "운송 서비스",
    "Radio And Television Broadcasting And Communications Equipment": "방송·통신 장비",
    "Electronic Components": "전자 부품",
    "Air Freight/Delivery Services": "항공 화물·택배",
    "Trucking Freight/Courier Services": "트럭 운송·택배",
    "Oilfield Services/Equipment": "유전 서비스·장비",
    "Biotechnology: In Vitro & In Vivo Diagnostic Substances": "바이오: 체외·체내 진단 물질",
    "Computer peripheral equipment": "컴퓨터 주변기기",
    "Home Furnishings": "가구·인테리어",
    "Recreational Games/Products/Toys": "게임·레저 용품·완구",
    "Recreational Products/Toys": "레저 용품·완구",
    "Engineering & Construction": "엔지니어링·건설",
    "Retail-Auto Dealers and Gas Stations": "자동차 판매·주유소",
    "Computer Communications Equipment": "컴퓨터 통신 장비",
    "Cable & Other Pay Television Services": "케이블·유료 방송",
    "Integrated Freight & Logistics": "종합 물류",
    "Containers/Packaging": "용기·포장",
    "Oil and Gas Field Machinery": "유전 기계",
    "RETAIL: Building Materials": "소매: 건축 자재",
    "Retail: Building Materials": "소매: 건축 자재",
    "Construction/Ag Equipment/Trucks": "건설·농기계·트럭",
    "Oil/Gas Transmission": "석유·가스 수송",
    "Integrated oil Companies": "종합 석유",
    "Movies/Entertainment": "영화·엔터테인먼트",
    "Biotechnology: Commercial Physical & Biological Resarch": "바이오: 위탁 연구",
    "Biotechnology: Commercial Physical & Biological Research": "바이오: 위탁 연구",
    "Food Chains": "식료품 체인",
    "Water Supply": "수도",
    "Hospital/Nursing Management": "병원·요양 시설 운영",
    "Coal Mining": "석탄 채굴",
    "Agricultural Chemicals": "농화학",
    "Office Equipment/Supplies/Services": "사무용품·사무 서비스",
    "Department/Specialty Retail Stores": "백화점·전문 소매",
    "Environmental Services": "환경 서비스",
    "Multi-Sector Companies": "복합 기업",
    "Other Metals and Minerals": "기타 금속·광물",
    "Building Products": "건축 제품",
    "Publishing": "출판",
    "Railroads": "철도",
    "Computer Manufacturing": "컴퓨터 제조",
    "Oil Refining/Marketing": "정유·석유 판매",
    "Consumer Specialties": "소비자 특수 제품",
    "Building Materials": "건축 자재",
    "Miscellaneous manufacturing industries": "기타 제조업",
    "Food Distributors": "식품 유통",
    "Other Pharmaceuticals": "기타 제약",
    "Misc Health and Biotechnology Services": "기타 헬스케어·바이오 서비스",
    "Specialty Foods": "특수 식품",
    "Ophthalmic Goods": "안과 용품",
    "Shoe Manufacturing": "신발 제조",
    "Plastic Products": "플라스틱 제품",
    "Building operators": "건물 운영",
    "Ordnance And Accessories": "무기·탄약",
    "Automotive Aftermarket": "자동차 애프터마켓",
    "Retail: Computer Software & Peripheral Equipment": "소매: 컴퓨터 소프트웨어·주변기기",
    "Motor Vehicles": "자동차",
    "Water Sewer Pipeline Comm & Power Line Construction": "상하수도·통신·전력선 공사",
    "Paper": "제지",
    "Forest Products": "임산물",
    "Fluid Controls": "유체 제어",
    "Rental/Leasing Companies": "렌탈·리스",
    "Newspapers/Magazines": "신문·잡지",
    "Specialty Chemicals": "특수 화학",
    "Meat/Poultry/Fish": "육류·가금류·수산물",
    "Textiles": "섬유",
    "Garments and Clothing": "의복",
    "Auto & Home Supply Stores": "자동차·생활용품 소매",
    "Consumer Electronics/Video Chains": "가전·영상 소매 체인",
    "Misc Corporate Leasing Services": "기타 기업 리스",
    "Retail-Drug Stores and Proprietary Stores": "약국·드럭스토어",
    "Accident &Health Insurance": "상해·건강보험",
    "Diversified Financial Services": "종합 금융 서비스",
    "Durable Goods": "내구재",
    "Miscellaneous": "기타",
    "Pollution Control Equipment": "오염 방지 장비",
    "Medical Electronics": "의료 전자기기",
    "Books": "도서",
    "Precision Instruments": "정밀 기기",
    "Wholesale Distributors": "도매 유통",
    "Paints/Coatings": "도료·코팅",
    "Tobacco": "담배",
    "Aluminum": "알루미늄",
    "Professional and commerical equipment": "전문·상업용 장비",
    "General Bldg Contractors - Nonresidential Bldgs": "비주거 건물 시공",
    "Managed Health Care": "관리형 의료보험",
    "Pharmaceuticals and Biotechnology": "제약·바이오",
    "Major Pharmaceuticals": "대형 제약",
    "Other Transportation": "기타 운송",
    "Electronics Distribution": "전자제품 유통",
    "Tools/Hardware": "공구·철물",
    "Diversified Electronic Products": "종합 전자제품",
    "Diversified Manufacture": "종합 제조",
}

#: 야후 산업 분류(대분류마다). 야후는 'Software—Infrastructure'(긴 줄표)와 'Software - Infrastructure'
#: 를 섞어 쓴다 — 찾을 때 줄표를 맞춘다(_산업열쇠)
_야후산업: dict[str, str] = {
    # 소재
    "Agricultural Inputs": "농업 자재", "Chemicals": "화학", "Lumber & Wood Production": "목재",
    "Paper & Paper Products": "제지", "Copper": "구리", "Other Industrial Metals & Mining": "기타 산업용 금속·광업",
    "Gold": "금", "Silver": "은", "Other Precious Metals & Mining": "기타 귀금속·광업", "Coking Coal": "제철용 석탄",
    "Steel": "철강",
    # 커뮤니케이션
    "Advertising Agencies": "광고 대행", "Electronic Gaming & Multimedia": "게임·멀티미디어",
    "Entertainment": "엔터테인먼트", "Internet Content & Information": "인터넷 콘텐츠·정보",
    "Telecom Services": "통신 서비스",
    # 경기소비재
    "Apparel Manufacturing": "의류 제조", "Apparel Retail": "의류 소매", "Auto & Truck Dealerships": "자동차·트럭 판매",
    "Auto Manufacturers": "자동차 제조", "Auto Parts": "자동차 부품", "Department Stores": "백화점",
    "Footwear & Accessories": "신발·잡화", "Furnishings, Fixtures & Appliances": "가구·설비·가전",
    "Gambling": "도박·게임", "Home Improvement Retail": "주택 개량 소매", "Internet Retail": "온라인 소매",
    "Leisure": "레저", "Lodging": "숙박", "Luxury Goods": "명품", "Packaging & Containers": "포장·용기",
    "Personal Services": "개인 서비스", "Recreational Vehicles": "레저용 차량", "Residential Construction": "주택 건설",
    "Resorts & Casinos": "리조트·카지노", "Specialty Retail": "전문 소매", "Textile Manufacturing": "섬유 제조",
    "Travel Services": "여행 서비스",
    # 필수소비재
    "Beverages—Brewers": "맥주", "Beverages—Non-Alcoholic": "비주류 음료",
    "Beverages—Wineries & Distilleries": "와인·증류주", "Confectioners": "제과", "Discount Stores": "할인점",
    "Education & Training Services": "교육·훈련 서비스", "Farm Products": "농산물", "Food Distribution": "식품 유통",
    "Grocery Stores": "식료품점", "Household & Personal Products": "생활·개인용품",
    # 에너지
    "Oil & Gas Drilling": "석유·가스 시추", "Oil & Gas E&P": "석유·가스 탐사·생산",
    "Oil & Gas Equipment & Services": "석유·가스 장비·서비스", "Oil & Gas Integrated": "종합 석유·가스",
    "Oil & Gas Midstream": "석유·가스 수송·저장", "Oil & Gas Refining & Marketing": "정유",
    "Thermal Coal": "발전용 석탄", "Uranium": "우라늄",
    # 금융
    "Asset Management": "자산운용", "Banks—Diversified": "종합은행", "Banks—Regional": "지방은행",
    "Capital Markets": "자본시장", "Credit Services": "신용 서비스", "Financial Conglomerates": "금융 복합기업",
    "Financial Data & Stock Exchanges": "금융 정보·거래소", "Insurance Brokers": "보험 중개",
    "Insurance—Diversified": "종합 보험", "Insurance—Life": "생명보험", "Insurance—Property & Casualty": "손해보험",
    "Insurance—Reinsurance": "재보험", "Insurance—Specialty": "특수 보험", "Mortgage Finance": "주택담보 금융",
    "Shell Companies": "스팩·셸 컴퍼니",
    # 헬스케어
    "Biotechnology": "바이오", "Diagnostics & Research": "진단·연구", "Drug Manufacturers—General": "대형 제약",
    "Drug Manufacturers—Specialty & Generic": "전문·복제약 제약", "Health Information Services": "의료 정보 서비스",
    "Healthcare Plans": "건강보험", "Medical Care Facilities": "의료 시설", "Medical Devices": "의료기기",
    "Medical Distribution": "의약품 유통", "Medical Instruments & Supplies": "의료 기구·소모품",
    "Pharmaceutical Retailers": "약국",
    # 산업재
    "Aerospace & Defense": "항공우주·방산", "Airlines": "항공사", "Airports & Air Services": "공항·항공 서비스",
    "Building Products & Equipment": "건축 제품·설비", "Business Equipment & Supplies": "사무 장비·용품",
    "Conglomerates": "복합기업", "Consulting Services": "컨설팅", "Electrical Equipment & Parts": "전기 장비·부품",
    "Farm & Heavy Construction Machinery": "농기계·건설기계", "Industrial Distribution": "산업재 유통",
    "Infrastructure Operations": "인프라 운영", "Marine Shipping": "해운", "Metal Fabrication": "금속 가공",
    "Pollution & Treatment Controls": "오염 방지·처리", "Rental & Leasing Services": "렌탈·리스",
    "Security & Protection Services": "보안·경호", "Specialty Business Services": "전문 사업 서비스",
    "Specialty Industrial Machinery": "특수 산업 기계", "Staffing & Employment Services": "인력 파견·채용",
    "Tools & Accessories": "공구·부속", "Trucking": "트럭 운송", "Waste Management": "폐기물 관리",
    # 부동산
    "Real Estate—Development": "부동산 개발", "Real Estate Services": "부동산 서비스",
    "Real Estate—Diversified": "종합 부동산", "REIT—Diversified": "리츠: 종합",
    "REIT—Healthcare Facilities": "리츠: 의료 시설", "REIT—Hotel & Motel": "리츠: 호텔",
    "REIT—Industrial": "리츠: 산업 시설", "REIT—Mortgage": "리츠: 모기지", "REIT—Office": "리츠: 오피스",
    "REIT—Residential": "리츠: 주거", "REIT—Retail": "리츠: 상업 시설", "REIT—Specialty": "리츠: 특수",
    # 기술
    "Communication Equipment": "통신 장비", "Computer Hardware": "컴퓨터 하드웨어",
    "Consumer Electronics": "소비자 가전", "Electronics & Computer Distribution": "전자·컴퓨터 유통",
    "Information Technology Services": "IT 서비스", "Scientific & Technical Instruments": "과학·기술 기기",
    "Semiconductor Equipment & Materials": "반도체 장비·소재", "Software—Application": "응용 소프트웨어",
    "Software—Infrastructure": "인프라 소프트웨어", "Solar": "태양광",
    # 유틸리티
    "Utilities—Diversified": "종합 유틸리티", "Utilities—Independent Power Producers": "민간 발전",
    "Utilities—Regulated Electric": "전력", "Utilities—Regulated Gas": "가스",
    "Utilities—Regulated Water": "수도", "Utilities—Renewable": "신재생 에너지",
}


def _산업열쇠(이름: str) -> str:
    """'Software - Infrastructure'·'Software–Infrastructure'·'software—infrastructure' 를 한 열쇠로.
    표의 이름도 같은 식으로 바꿔 담으니 'Non-Alcoholic' 처럼 낱말 안의 붙임표도 그대로 맞는다"""
    return re.sub(r"\s+", " ", re.sub(r"\s*[—–-]\s*", "—", 이름.strip())).lower()


_산업찾기: dict[str, str] = {}
for _표 in (_나스닥산업, _야후산업):
    for _영, _한 in _표.items():
        _산업찾기.setdefault(_산업열쇠(_영), _한)
_나라찾기 = {k.lower(): v for k, v in 나라_한글.items()}
#: 모르는 이름 — 한 번만 기록한다
_모름: set[str] = set()


def _모르는(종류: str, 이름: str) -> str:
    if (종류, 이름) not in _모름 and len(_모름) < 500:
        _모름.add((종류, 이름))
        log.info("스크리닝 %s 한글 이름 없음: %r", 종류, 이름)
    return 이름


def 산업_이름(산업: object) -> str | None:
    """영문 산업 → 한국어. 이미 한국어(국내 표준산업분류)면 그대로, 모르면 영문 그대로"""
    if not isinstance(산업, str) or not 산업.strip():
        return None
    산업 = 산업.strip()
    if re.search(r"[가-힣]", 산업):
        return 산업
    return _산업찾기.get(_산업열쇠(산업)) or _모르는("산업", 산업)


def 나라_이름(나라: object) -> str | None:
    if not isinstance(나라, str) or not 나라.strip():
        return None
    나라 = 나라.strip()
    if re.search(r"[가-힣]", 나라):
        return 나라
    return 나라_한글.get(나라) or _나라찾기.get(나라.lower()) or _모르는("나라", 나라)


#: 표준산업분류 이름 → KRX 업종(어림). 앞의 것부터 — '산업용 기계 및 장비 임대업' 은 기계가 아니라 임대업,
#: '기타 비금속 광물제품' 은 금속이 아니라 비금속, '음·식료품 도매업' 은 식품이 아니라 유통이다. KRX 업종
#: 이름과 같은 말을 쓴다(KRX 업종과 한 표에 섞여도 갈리지 않게)
_업종어림: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("부동산", ("부동산",)),
    ("금융", ("은행", "금융", "보험", "증권", "신탁", "여신", "저축", "투자")),
    ("유통", ("도매업", "소매업", "상품 중개", "무역", "판매업")),
    ("일반서비스", ("임대업", "연구개발", "교육", "교습", "학원", "병원", "의원", "사업지원", "사업 지원", "인력",
                 "경비", "경호", "여행", "숙박", "음식점", "전문 서비스", "기술 서비스", "디자인", "회사 본부",
                 "경영 컨설팅", "조사업", "수리업", "폐기물", "원료 재생")),
    ("건설", ("건설", "공사업", "토목")),
    ("제약", ("의약",)),
    ("의료·정밀기기", ("의료용 기기", "의료기기", "정밀기기", "측정", "광학", "안경", "치과")),
    ("전기·전자", ("반도체", "전자부품", "전자 부품", "컴퓨터 및 주변", "통신 및 방송 장비", "영상 및 음향",
                "전동기", "발전기", "전기 변환", "축전지", "이차전지", "일차전지", "절연선", "전구", "조명",
                "가정용 기기", "전기장비", "전기 장비", "디스플레이", "인쇄회로기판", "전자")),
    ("IT 서비스", ("소프트웨어", "컴퓨터 프로그래밍", "시스템 통합", "정보서비스", "정보 서비스", "자료처리",
                 "자료 처리", "호스팅", "포털", "인터넷")),
    ("통신", ("전기 통신", "전기통신", "통신업")),
    ("운송장비·부품", ("자동차", "트레일러", "선박", "보트", "항공기", "우주선", "철도장비", "철도 장비", "운송장비")),
    ("화학", ("화학", "합성수지", "플라스틱", "고무", "비료", "농약", "화장품", "세제", "도료", "석유 정제", "코크스")),
    ("비금속", ("비금속", "시멘트", "유리", "도자기", "요업", "콘크리트", "석회")),
    ("금속", ("철강", "비철금속", "비철 금속", "금속 주조", "금속가공", "금속 가공", "구조용 금속", "1차 금속", "금속")),
    ("기계·장비", ("기계", "장비 제조", "펌프", "엔진", "터빈", "로봇", "공구", "냉동", "냉장")),
    ("음식료·담배", ("식료품", "식품", "음료", "담배", "제과", "과자", "육류", "과실", "채소", "수산물", "곡물",
                  "사료", "주류", "낙농", "작물", "어업", "어로")),
    ("섬유·의류", ("섬유", "방적", "직물", "의복", "의류", "가죽", "가방", "신발", "편조")),
    ("오락·문화", ("영화", "방송", "오디오", "음악", "출판", "복제업", "게임", "오락", "스포츠", "유원지", "공연",
                "예술", "광고", "잡지", "신문")),
    ("종이·목재", ("펄프", "종이", "판지", "목재", "나무", "인쇄")),
    ("전기·가스", ("전기업", "발전업", "가스 제조", "가스업", "증기", "공기조절", "공기 조절")),
    ("운송·창고", ("운송업", "운송 관련", "운송관련", "창고", "택배", "물류")),
    ("일반서비스", ("서비스업",)),
    ("기타제조", ("제조업",)),
)


def 국내업종_어림(산업: object) -> str | None:
    """국내 표준산업분류 이름('반도체 제조업') → KRX 업종 이름('전기·전자'). 모르면 None"""
    if not isinstance(산업, str) or not 산업.strip():
        return None
    for 업종, 말들 in _업종어림:
        if any(말 in 산업 for 말 in 말들):
            return 업종
    return None
