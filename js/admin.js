// =============================================
//  ADMIN PANEL LOGIC — My AdTeach
// =============================================

auth.onAuthStateChanged(async (user)=>{
  if(!user){
    window.location.href='login.html';
    return;
  }
  try{
    const docSnap=await db.collection('users').doc(user.uid).get();
    if(!docSnap.exists||docSnap.data().isAdmin!==true){
      alert('Anda tidak memiliki akses ke halaman admin.');
      await auth.signOut();
      window.location.href='login.html';
      return;
    }
    document.getElementById('adminEmail').textContent=user.email;
    loadUsers();
  }catch(e){
    console.error(e);
    alert('Terjadi kesalahan saat memuat data admin.');
  }
});

function adminLogout(){
  auth.signOut().then(()=>window.location.href='login.html');
}

async function loadUsers(){
  try{
    const snap=await db.collection('users').orderBy('createdAt','desc').get();
    const all=[];
    snap.forEach(doc=>all.push({id:doc.id,...doc.data()}));

    const pending=all.filter(u=>u.isApproved!==true);
    const approved=all.filter(u=>u.isApproved===true);

    document.getElementById('stat-pending').textContent=pending.length;
    document.getElementById('stat-approved').textContent=approved.length;
    document.getElementById('stat-total').textContent=all.length;

    const tblPending=document.getElementById('tbl-pending');
    tblPending.innerHTML=pending.length?pending.map(u=>`
      <tr>
        <td><b>${u.nama||'-'}</b></td>
        <td>${u.email||'-'}</td>
        <td><span class="badge bg-warning">Menunggu</span></td>
        <td>
          <button class="btn btn-success btn-sm" onclick="approveUser('${u.id}')"><i class="fas fa-check"></i> Setujui</button>
          <button class="btn btn-danger btn-sm" onclick="rejectUser('${u.id}','${(u.nama||'').replace(/'/g,"")}')"><i class="fas fa-times"></i> Tolak</button>
        </td>
      </tr>`).join(''):'<tr><td colspan="4" class="empty">Tidak ada akun yang menunggu persetujuan</td></tr>';

    const tblApproved=document.getElementById('tbl-approved');
    tblApproved.innerHTML=approved.length?approved.map(u=>`
      <tr>
        <td><b>${u.nama||'-'}</b></td>
        <td>${u.email||'-'}</td>
        <td><span class="badge bg-success">Disetujui</span></td>
        <td><button class="btn btn-outline btn-sm" onclick="revokeUser('${u.id}')"><i class="fas fa-ban"></i> Cabut Akses</button></td>
      </tr>`).join(''):'<tr><td colspan="4" class="empty">Belum ada guru yang disetujui</td></tr>';

  }catch(e){
    console.error(e);
    document.getElementById('tbl-pending').innerHTML='<tr><td colspan="4" class="empty">Gagal memuat data</td></tr>';
    document.getElementById('tbl-approved').innerHTML='<tr><td colspan="4" class="empty">Gagal memuat data</td></tr>';
  }
}

async function approveUser(uid){
  try{
    await db.collection('users').doc(uid).update({isApproved:true});
    loadUsers();
  }catch(e){alert('Gagal menyetujui akun: '+e.message)}
}

async function rejectUser(uid,nama){
  if(!confirm(`Tolak dan hapus pendaftaran "${nama}"? Tindakan ini tidak bisa dibatalkan.`))return;
  try{
    await db.collection('users').doc(uid).delete();
    loadUsers();
  }catch(e){alert('Gagal menolak akun: '+e.message)}
}

async function revokeUser(uid){
  if(!confirm('Cabut akses guru ini? Guru tidak akan bisa masuk lagi sampai disetujui ulang.'))return;
  try{
    await db.collection('users').doc(uid).update({isApproved:false});
    loadUsers();
  }catch(e){alert('Gagal mencabut akses: '+e.message)}
}
