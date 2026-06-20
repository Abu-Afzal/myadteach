// =============================================
//  LOGIN / REGISTER LOGIC — My AdTeach
// =============================================

function switchAuthTab(tab){
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  document.querySelectorAll('.auth-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+tab).classList.add('active');
  hideMsg();
}

function togglePw(id,btn){
  const el=document.getElementById(id);
  const isPw=el.type==='password';
  el.type=isPw?'text':'password';
  btn.textContent=isPw?'SEMBUNYIKAN':'LIHAT';
}

function showMsg(text,type='error'){
  const el=document.getElementById('authMsg');
  el.textContent=text;
  el.className='auth-msg show '+type;
}
function hideMsg(){
  const el=document.getElementById('authMsg');
  el.className='auth-msg';
}

function setBtnLoading(btnId,loading,label){
  const btn=document.getElementById(btnId);
  btn.disabled=loading;
  btn.innerHTML=loading?'<i class="fas fa-spinner fa-spin"></i> Memproses...':label;
}

// ---------- REGISTER ----------
async function doRegister(){
  const nama=document.getElementById('reg-nama').value.trim();
  const email=document.getElementById('reg-email').value.trim();
  const password=document.getElementById('reg-password').value;
  hideMsg();
  if(!nama||!email||!password){showMsg('Lengkapi semua field terlebih dahulu');return}
  if(password.length<6){showMsg('Password minimal 6 karakter');return}
  setBtnLoading('btnRegister',true,'<i class="fas fa-user-plus"></i> Daftar');
  try{
    const cred=await auth.createUserWithEmailAndPassword(email,password);
    const uid=cred.user.uid;
    await db.collection('users').doc(uid).set({
      email,
      nama,
      isApproved:false,
      isAdmin:false,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    await auth.signOut();
    document.querySelectorAll('.auth-panel').forEach(p=>p.classList.remove('active'));
    document.getElementById('panel-pending').classList.add('active');
    document.getElementById('authTabs').style.display='none';
  }catch(e){
    showMsg(mapAuthError(e));
  }finally{
    setBtnLoading('btnRegister',false,'<i class="fas fa-user-plus"></i> Daftar');
  }
}

// ---------- LOGIN ----------
async function doLogin(){
  const email=document.getElementById('login-email').value.trim();
  const password=document.getElementById('login-password').value;
  hideMsg();
  if(!email||!password){showMsg('Email dan password wajib diisi');return}
  setBtnLoading('btnLogin',true,'<i class="fas fa-right-to-bracket"></i> Masuk');
  try{
    await auth.signInWithEmailAndPassword(email,password);
    // Pengecekan approval & redirect ditangani oleh onAuthStateChanged di bawah
  }catch(e){
    showMsg(mapAuthError(e));
    setBtnLoading('btnLogin',false,'<i class="fas fa-right-to-bracket"></i> Masuk');
  }
}

// ---------- FORGOT PASSWORD ----------
async function doForgotPassword(){
  const email=document.getElementById('login-email').value.trim();
  if(!email){showMsg('Masukkan email Anda terlebih dahulu di kolom email, lalu klik Lupa Password lagi');return}
  try{
    await auth.sendPasswordResetEmail(email);
    showMsg('Tautan reset password telah dikirim ke '+email,'success');
  }catch(e){
    showMsg(mapAuthError(e));
  }
}

function doLogout(){
  auth.signOut();
  document.querySelectorAll('.auth-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-login').classList.add('active');
  document.getElementById('authTabs').style.display='flex';
  switchAuthTab('login');
}

// ---------- AUTH STATE WATCHER ----------
auth.onAuthStateChanged(async (user)=>{
  if(!user)return; // belum login, biarkan di halaman login
  try{
    const docSnap=await db.collection('users').doc(user.uid).get();
    if(!docSnap.exists){
      setBtnLoading('btnLogin',false,'<i class="fas fa-right-to-bracket"></i> Masuk');
      showMsg('Akun tidak ditemukan di sistem. Hubungi admin.');
      await auth.signOut();
      return;
    }
    const data=docSnap.data();
    if(data.isApproved===true){
      window.location.href='index.html';
    } else {
      setBtnLoading('btnLogin',false,'<i class="fas fa-right-to-bracket"></i> Masuk');
      document.querySelectorAll('.auth-panel').forEach(p=>p.classList.remove('active'));
      document.getElementById('panel-pending').classList.add('active');
      document.getElementById('authTabs').style.display='none';
    }
  }catch(e){
    console.error(e);
    setBtnLoading('btnLogin',false,'<i class="fas fa-right-to-bracket"></i> Masuk');
    showMsg('Terjadi kesalahan saat memeriksa status akun. Coba lagi.');
  }
});

function mapAuthError(e){
  const code=e.code||'';
  const map={
    'auth/email-already-in-use':'Email ini sudah terdaftar. Silakan masuk atau gunakan email lain.',
    'auth/invalid-email':'Format email tidak valid.',
    'auth/weak-password':'Password terlalu lemah, minimal 6 karakter.',
    'auth/user-not-found':'Email belum terdaftar.',
    'auth/wrong-password':'Password salah.',
    'auth/invalid-credential':'Email atau password salah.',
    'auth/too-many-requests':'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.',
    'auth/network-request-failed':'Koneksi internet bermasalah. Periksa jaringan Anda.'
  };
  return map[code]||('Terjadi kesalahan: '+(e.message||code));
}
