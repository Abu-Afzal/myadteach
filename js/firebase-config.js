// =============================================
//  FIREBASE CONFIG & INISIALISASI
//  My AdTeach — Aplikasi Administrasi Guru
// =============================================

const firebaseConfig = {
  apiKey: "AIzaSyBxt_rOoO_Sx-JM45znASJB2jK-D5jCojg",
  authDomain: "myadteach.firebaseapp.com",
  projectId: "myadteach",
  storageBucket: "myadteach.firebasestorage.app",
  messagingSenderId: "243791364174",
  appId: "1:243791364174:web:fad268beae145ae181431f",
  measurementId: "G-N21074RDKF"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Aktifkan cache offline supaya aplikasi tetap bisa dipakai sebentar saat koneksi terputus
db.enablePersistence({synchronizeTabs:true}).catch(err=>{
  if(err.code==='failed-precondition'){
    console.warn('Persistence gagal: multiple tab terbuka tanpa synchronizeTabs');
  } else if(err.code==='unimplemented'){
    console.warn('Browser ini tidak mendukung persistence offline');
  }
});
