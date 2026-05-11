// ═══════════════════════════════════════════════════════
// 🔥 firebase-shared.js
// 목적: Firebase 초기화 & 공용 함수 모음
// 모바일/PC 양쪽 모두 로드됨
// ═══════════════════════════════════════════════════════

// 1️⃣ Firebase 설정 (변경 금지)
const firebaseConfig = {
    apiKey: "AIzaSyDGdi03xiK44WzrK8082VjUPsIujQmN7_A",
    authDomain: "yongjin-enterprise.firebaseapp.com",
    projectId: "yongjin-enterprise",
    storageBucket: "yongjin-enterprise.firebasestorage.app",
    messagingSenderId: "364016255378",
    appId: "1:364016255378:web:387f6145265e0a567d814b"
};

// 2️⃣ Firebase 초기화
let db = null;
let auth = null;

function initializeFirebase() {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    auth = firebase.auth();
    
    // 🚀 [핵심 수정 사항]: index.html이 통신망을 사용할 수 있도록 전역 개방
    window.db = db;
    window.auth = auth;
    
    console.log('✅ Firebase 초기화 완료 (전역 공유됨)');
}

// 3️⃣ 익명 로그인
async function signInAnonymously() {
    try {
        await auth.signInAnonymously();
        console.log('✅ 익명 인증 완료');
        return true;
    } catch (e) {
        console.error('❌ 인증 실패:', e);
        return false;
    }
}

// 4️⃣ 사용자 동기화 (참고용 - 실제 화면 그리기는 index.html의 syncUsers가 담당)
let USERS = [];

async function syncUsers() {
    try {
        const snapshot = await db.collection('users')
            .where('status', '==', 'active')
            .orderBy('sort_index', 'asc')
            .get();

        USERS = snapshot.docs.map(doc => {
            const d = doc.data();
            if (d.role === 'ccounting') d.role = 'accounting';
            return { id: doc.id, ...d };
        });

        console.log('✅ 사용자 목록 로드 (공용):', USERS.length + '명');
        
        // 🚀 [추가 조치]: 데이터를 불러온 후 전역 USERS 변수에도 할당
        window.USERS = USERS; 
        
        return USERS;
    } catch (e) {
        console.error('❌ 사용자 로드 실패:', e);
        return [];
    }
}

// 5️⃣ 내보내기
window.FirebaseShared = {
    initializeFirebase,
    signInAnonymously,
    syncUsers,
    getDB: () => db,
    getAuth: () => auth,
    getUsers: () => USERS
};

console.log('📦 firebase-shared.js 로드 완료');
