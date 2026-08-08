// Initial realistic sample data for 꽁초헌터 (Cigarette Butt Hunter)
export const INITIAL_REPORTS = [
  {
    id: "rep-101",
    title: "강남역 11번 출구 뒤편 골목 꽁초 무단투기",
    description: "유동인구가 많은 술집 골목 입구입니다. 벤치와 배수구 주위에 담배꽁초가 수백 개 산적해 있어 비가 오면 배수구가 막힐 위험이 있습니다.",
    imageUrl: "https://images.unsplash.com/photo-1596484552834-6a58f850e0a1?auto=format&fit=crop&w=800&q=80",
    latitude: 37.498095,
    longitude: 127.027610,
    address: "서울특별시 강남구 테헤란로1길 10",
    severity: "critical", // critical, severe, medium, slight
    status: "reported", // reported, in_progress, cleaned
    userName: "클린강남지킴이",
    userAvatar: "CG",
    likesCount: 24,
    cleanupVotes: 18,
    createdAt: "2026-08-08T06:30:00Z",
    comments: [
      { id: "c-1", author: "환경사랑", text: "여기 매일 저녁마다 꽁초 엄청 싸입니다 ㅠㅠ 수거함 설치가 시급해요!", time: "1시간 전" },
      { id: "c-2", author: "에코헌터", text: "이번 주말 플로깅 봉사활동 때 집중 청소구역으로 지정하겠습니다.", time: "30분 전" }
    ]
  },
  {
    id: "rep-102",
    title: "홍대 클럽거리 입구 배수관 주변",
    description: "주말 지나고 나면 길거리가 담배꽁초밭이 됩니다. 빗물받이 구멍 사이로 꽁초가 가득 들어가 있어서 해양 오염이 우려됩니다.",
    imageUrl: "https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&w=800&q=80",
    latitude: 37.550882,
    longitude: 126.923891,
    address: "서울특별시 마포구 와우산로 19길",
    severity: "severe",
    status: "in_progress",
    userName: "홍대클린헌터",
    userAvatar: "HD",
    likesCount: 42,
    cleanupVotes: 35,
    createdAt: "2026-08-07T18:20:00Z",
    comments: [
      { id: "c-3", author: "마포구민", text: "구청에 민원 넣었는데 꽁초 전용 재해 예방 덮개라도 씌웠으면 좋겠네요.", time: "어제" }
    ]
  },
  {
    id: "rep-103",
    title: "성수동 카페거리 야외 테라스 인근",
    description: "인도 화단 구석에 꽁초가 무단으로 버려지고 있습니다. 시민 헌터분들과 정화 활동 후 깔끔하게 청소 완료했습니다!",
    imageUrl: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&w=800&q=80",
    latitude: 37.544520,
    longitude: 127.055720,
    address: "서울특별시 성동구 연무장길 32",
    severity: "medium",
    status: "cleaned",
    userName: "성수GreenLife",
    userAvatar: "SS",
    likesCount: 89,
    cleanupVotes: 50,
    createdAt: "2026-08-06T14:15:00Z",
    comments: [
      { id: "c-4", author: "제로웨이스트", text: "우와 정화 작업 수고하셨습니다!! 너무 깨끗해졌네요 👏", time: "2일 전" }
    ]
  },
  {
    id: "rep-104",
    title: "부산 서면 1번가 흡연 잔재 구역",
    description: "상가 건물 사이 통로 바닥에 꽁초 및 플라스틱 컵이 방치되어 있습니다. 인근 상인분들의 주의가 필요합니다.",
    imageUrl: "https://images.unsplash.com/photo-1584467735871-8e85353a8413?auto=format&fit=crop&w=800&q=80",
    latitude: 35.157810,
    longitude: 129.059280,
    address: "부산광역시 부산진구 중앙대로692번길",
    severity: "severe",
    status: "reported",
    userName: "갈매기헌터",
    userAvatar: "BS",
    likesCount: 15,
    cleanupVotes: 12,
    createdAt: "2026-08-08T02:10:00Z",
    comments: []
  },
  {
    id: "rep-105",
    title: "인천 송도 센트럴파크 정자 주변",
    description: "공원 산책로 벤치 뒤편에 담배꽁초 몇 개가 수풀 속에 버려져 있습니다. 화재 위험이 있으니 빠른 조치가 필요합니다.",
    imageUrl: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
    latitude: 37.392640,
    longitude: 126.639520,
    address: "인천광역시 연수구 컨벤시아대로 160",
    severity: "slight",
    status: "reported",
    userName: "송도에코보이",
    userAvatar: "SD",
    likesCount: 8,
    cleanupVotes: 5,
    createdAt: "2026-08-07T21:45:00Z",
    comments: []
  }
];
