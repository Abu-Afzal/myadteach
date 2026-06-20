// =============================================
//  MY ADTEACH — FULL FUNCTIONAL ENGINE
//  (Firestore edition)
// =============================================

// ---------- DB (Firestore) ----------
// Setiap field disimpan sebagai satu dokumen di koleksi users/{uid}/data/{key}
// supaya pola pemanggilan tetap sama persis seperti versi localStorage sebelumnya.
let _currentUid=null;

const DB = {
  async get(k){
    if(!_currentUid)return null;
    try{
      const snap=await db.collection('users').doc(_currentUid).collection('data').doc(k).get();
      if(!snap.exists)return null;
      const d=snap.data();
      return d&&('value' in d)?d.value:null;
    }catch(e){console.error('DB.get gagal untuk',k,e);return null}
  },
  async set(k,v){
    if(!_currentUid)return;
    try{
      await db.collection('users').doc(_currentUid).collection('data').doc(k).set({value:v});
    }catch(e){console.error('DB.set gagal untuk',k,e);toast('Gagal menyimpan ke server. Periksa koneksi internet.','error')}
  },
  async del(k){
    if(!_currentUid)return;
    try{
      await db.collection('users').doc(_currentUid).collection('data').doc(k).delete();
    }catch(e){console.error('DB.del gagal untuk',k,e)}
  }
};

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2)}

// ---------- STATE ----------
let state = {
  kelas:[], siswa:[], jadwal:[], absensi:{}, nilai:{}, jurnal:[],
  rpp:[], tugas:[], nilaiTugas:{}, soal:[],
  profil:{nama:'',nip:'',mapel:'',hp:'',email:''},
  sekolah:{nama:'',npsn:'',ta:'2025/2026',sem:'Genap',kurk:'Kurikulum Merdeka',kkm:75,alamat:''},
  currentPage:'dashboard', calYear:0, calMonth:0,
  nilaiKolom:{}, editTugasId:null
};

const STATE_KEYS=['kelas','siswa','jadwal','absensi','nilai','jurnal','rpp','tugas','nilaiTugas','soal','profil','sekolah','nilaiKolom'];

async function loadState(){
  await Promise.all(STATE_KEYS.map(async k=>{
    const v=await DB.get(k);
    if(v!==null)state[k]=v;
  }));
}
function saveState(){
  // Fire-and-forget: UI tidak menunggu network, tapi tiap penulisan tetap diawasi errornya
  STATE_KEYS.forEach(k=>{
    DB.set(k,state[k]);
  });
}

// ---------- INIT ----------
async function init(){
  showAppLoading(true);
  await loadState();
  const now=new Date();
  state.calYear=now.getFullYear();state.calMonth=now.getMonth();
  document.getElementById('dateChip').textContent=now.toLocaleDateString('id-ID',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  loadProfil();
  populateAllSelects();
  renderDashboard();
  updateBadges();
  // Set default dates
  document.getElementById('absTgl').value=toDateStr(now);
  document.getElementById('j-tgl').value=toDateStr(now);
  document.getElementById('tg-tgl').value=toDateStr(now);
  initAlarmEngine();
  showAppLoading(false);
}

function toDateStr(d){return d.toISOString().slice(0,10)}

// =============================================
//  ALARM JADWAL MENGAJAR
// =============================================
let _alarmLastFiredKey=null;
let _alarmAudioCtx=null;

function isAlarmEnabled(){
  return state.sekolah && state.sekolah.alarmAktif===true;
}

function setAlarmEnabled(val){
  if(!state.sekolah)state.sekolah={};
  state.sekolah.alarmAktif=val;
  saveState();
  renderAlarmStatusBadge();
}

function renderAlarmStatusBadge(){
  const badge=document.getElementById('alarm-status-badge');
  if(!badge)return;
  if(isAlarmEnabled()){
    badge.innerHTML='<i class="fas fa-bell"></i> Alarm Aktif';
    badge.className='badge bg-success';
  } else {
    badge.innerHTML='<i class="fas fa-bell-slash"></i> Alarm Nonaktif';
    badge.className='badge bg-gray';
  }
  const toggle=document.getElementById('set-alarm-toggle');
  if(toggle)toggle.checked=isAlarmEnabled();
}

function requestNotifPermission(){
  if(!('Notification' in window)){
    toast('Browser ini tidak mendukung notifikasi sistem','error');
    return;
  }
  Notification.requestPermission().then(perm=>{
    if(perm==='granted'){
      toast('Izin notifikasi diberikan. Alarm akan tampil meski berpindah tab.');
    } else {
      toast('Izin notifikasi ditolak. Alarm tetap berbunyi selama tab ini terbuka.','warn');
    }
    renderNotifPermStatus();
  });
}

function renderNotifPermStatus(){
  const el=document.getElementById('notif-perm-status');
  if(!el)return;
  if(!('Notification' in window)){el.textContent='Tidak didukung browser ini';return}
  const perm=Notification.permission;
  el.textContent=perm==='granted'?'Diizinkan ✓':perm==='denied'?'Ditolak ✗':'Belum diizinkan';
}

// Bunyikan beep singkat (penarik perhatian) sebelum suara bicara
function playAlarmBeep(){
  return new Promise((resolve)=>{
    try{
      if(!_alarmAudioCtx)_alarmAudioCtx=new (window.AudioContext||window.webkitAudioContext)();
      const ctx=_alarmAudioCtx;
      const playBeep=(startTime,freq)=>{
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.type='sine';
        osc.frequency.value=freq;
        gain.gain.setValueAtTime(0.0001,startTime);
        gain.gain.exponentialRampToValueAtTime(0.35,startTime+0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001,startTime+0.35);
        osc.connect(gain);gain.connect(ctx.destination);
        osc.start(startTime);osc.stop(startTime+0.4);
      };
      const now=ctx.currentTime;
      // 2 beep ganda (nada naik-turun) — lebih singkat dari versi sebelumnya agar tidak menunda suara bicara
      for(let i=0;i<2;i++){
        playBeep(now+i*0.55,880);
        playBeep(now+i*0.55+0.25,660);
      }
      setTimeout(resolve,1300);
    }catch(e){console.error('Gagal memutar beep:',e);resolve()}
  });
}

// Ucapkan kalimat pengingat lewat suara bicara (Web Speech API — tanpa file suara eksternal)
function speakAlarmMessage(kelasNama,mapel){
  if(!('speechSynthesis' in window)){
    console.warn('Browser ini tidak mendukung suara bicara (Web Speech API)');
    return;
  }
  const mapelText=mapel?`, mata pelajaran ${mapel},`:'';
  const kalimat=`Sekarang saatnya Anda mengajar di kelas ${kelasNama}${mapelText} Terima kasih!`;
  try{
    window.speechSynthesis.cancel(); // hentikan antrian ucapan sebelumnya jika ada
    const utter=new SpeechSynthesisUtterance(kalimat);
    utter.lang='id-ID';
    utter.rate=0.95;
    utter.pitch=1;
    utter.volume=1;
    // Pilih voice Bahasa Indonesia jika tersedia di browser/OS
    const voices=window.speechSynthesis.getVoices();
    const idVoice=voices.find(v=>v.lang==='id-ID')||voices.find(v=>v.lang.startsWith('id'));
    if(idVoice)utter.voice=idVoice;
    window.speechSynthesis.speak(utter);
  }catch(e){console.error('Gagal memutar suara bicara:',e)}
}

async function playAlarmSound(kelasNama,mapel){
  await playAlarmBeep();
  speakAlarmMessage(kelasNama||'Anda',mapel||'');
}

function fireScheduleAlarm(jadwalItem,kelasNama){
  playAlarmSound(kelasNama,jadwalItem.mapel);
  toast(`🔔 Saatnya mengajar ${kelasNama} (${jadwalItem.mulai})`,'warn');
  if('Notification' in window && Notification.permission==='granted'){
    try{
      new Notification('Waktunya Mengajar!',{
        body:`${kelasNama} · ${jadwalItem.mapel||''} · ${jadwalItem.mulai}${jadwalItem.ruang?' · '+jadwalItem.ruang:''}`,
        icon:'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/svgs/solid/graduation-cap.svg',
        tag:'myadteach-alarm'
      });
    }catch(e){console.error('Gagal menampilkan notifikasi:',e)}
  }
}

function checkScheduleAlarms(){
  if(!isAlarmEnabled())return;
  const now=new Date();
  const hariMap={0:'Minggu',1:'Senin',2:'Selasa',3:'Rabu',4:'Kamis',5:'Jumat',6:'Sabtu'};
  const hariIni=hariMap[now.getDay()];
  const jamSekarang=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const fireKey=toDateStr(now)+'_'+jamSekarang;
  if(_alarmLastFiredKey===fireKey)return; // sudah dicek menit ini, hindari duplikasi
  _alarmLastFiredKey=fireKey;
  state.jadwal.forEach(j=>{
    if(j.hari===hariIni && j.mulai===jamSekarang){
      const k=state.kelas.find(k=>k.id===j.kelas);
      fireScheduleAlarm(j,k?.nama||'Kelas');
    }
  });
}

function initAlarmEngine(){
  renderAlarmStatusBadge();
  renderNotifPermStatus();
  // Cek setiap 15 detik agar presisi menit tetap terjaga tanpa terlalu berat
  setInterval(checkScheduleAlarms,15000);
  checkScheduleAlarms();
  // Preload daftar voice TTS (di beberapa browser voices baru terisi setelah event ini)
  if('speechSynthesis' in window){
    window.speechSynthesis.onvoiceschanged=()=>{window.speechSynthesis.getVoices()};
  }
}

function testAlarmSound(){
  playAlarmSound('Contoh',  'Contoh Mapel');
  toast('Mencoba bunyi alarm...');
}

// ---------- NAVIGATION ----------
const PAGE_INFO={
  dashboard:{title:'Dashboard',sub:'Ringkasan aktivitas kelas Anda'},
  kelas:{title:'Data Kelas',sub:'Kelola kelas yang diampu'},
  siswa:{title:'Data Siswa',sub:'Manajemen biodata dan data siswa'},
  jadwal:{title:'Jadwal Mengajar',sub:'Kalender dan jadwal mengajar mingguan'},
  absensi:{title:'Absensi Siswa',sub:'Input dan monitoring kehadiran siswa'},
  nilai:{title:'Nilai Siswa',sub:'Input dan rekap nilai akademik siswa'},
  jurnal:{title:'Jurnal Mengajar',sub:'Dokumentasi kegiatan belajar mengajar'},
  rpp:{title:'RPP & Modul Ajar',sub:'Buat dan kelola RPP dengan bantuan AI'},
  tugas:{title:'Tugas & Kuis',sub:'Kelola penugasan dan penilaian'},
  banksoal:{title:'Bank Soal',sub:'Koleksi soal ulangan dan kuis'},
  analitik:{title:'Analitik Kelas',sub:'Laporan performa dan tren belajar'},
  rekap:{title:'Rekap & Cetak',sub:'Export dan cetak berbagai laporan'},
  pengaturan:{title:'Pengaturan',sub:'Profil guru dan konfigurasi aplikasi'}
};

function nav(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=document.getElementById('pg-'+id);
  if(pg)pg.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>{
    if(n.getAttribute('onclick')&&n.getAttribute('onclick').includes("'"+id+"'"))n.classList.add('active');
  });
  const info=PAGE_INFO[id]||{title:id,sub:''};
  document.getElementById('pageTitle').textContent=info.title;
  document.getElementById('pageSub').textContent=info.sub;
  state.currentPage=id;
  closeSidebar();
  // Render page
  const renders={
    dashboard:renderDashboard, kelas:renderKelas, siswa:renderSiswa,
    jadwal:renderJadwal, absensi:renderAbsensi, nilai:renderNilai,
    jurnal:renderJurnal, rpp:renderRPP, tugas:renderTugas,
    banksoal:renderSoal,
    analitik:renderAnalitik, pengaturan:renderPengaturan
  };
  if(renders[id])renders[id]();
}

function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('overlay').style.display='block'}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('overlay').style.display='none'}

// ---------- MODAL ----------
function openModal(id){document.getElementById(id).classList.add('open')}
function closeModal(id){document.getElementById(id).classList.remove('open')}

// ---------- TOAST ----------
function toast(msg,type='success'){
  const c=document.getElementById('toastContainer');
  const t=document.createElement('div');
  t.className='toast'+(type==='error'?' error':type==='warn'?' warn':'');
  const icon=type==='error'?'fa-times-circle':type==='warn'?'fa-exclamation-triangle':'fa-check-circle';
  t.innerHTML=`<i class="fas ${icon}"></i><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(30px)';t.style.transition='all .3s';setTimeout(()=>t.remove(),300)},3000);
}

// ---------- CONFIRM ----------
function confirm2(msg,cb){
  document.getElementById('konfirmasi-pesan').textContent=msg;
  const btn=document.getElementById('konfirmasi-ok');
  btn.onclick=()=>{closeModal('modalKonfirmasi');cb()};
  openModal('modalKonfirmasi');
}

// ---------- SELECTS ----------
function populateAllSelects(){
  const kelasOpts=state.kelas.map(k=>`<option value="${k.id}">${k.nama} - ${k.mapel}</option>`).join('');
  const allOpt='<option value="">-- Semua Kelas --</option>';
  ['filterKelasS','absKelas','nilaiKelas','filterJurnalKelas','rpp-kelas','tg-kelas','analitikKelas','filterTugasKelas','j-kelas','riwayatAbsKelas'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    if(id==='filterKelasS'||id==='riwayatAbsKelas')el.innerHTML=allOpt+kelasOpts;
    else el.innerHTML=kelasOpts||(id==='rpp-kelas'?'<option value="">-- Pilih Kelas --</option>':'<option value="">-- Pilih Kelas --</option>');
    if(id==='rpp-kelas'||id==='j-kelas')el.innerHTML='<option value="">-- Pilih Kelas --</option>'+kelasOpts;
  });
  ['s-kelas','jd-kelas'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.innerHTML=kelasOpts;
  });
  // Mapel filter soal
  const mEl=document.getElementById('filterSoalMapel');
  if(mEl){const mapels=[...new Set(state.soal.map(s=>s.mapel))];mEl.innerHTML='<option value="">Semua Mapel</option>'+mapels.map(m=>`<option value="${m}">${m}</option>`).join('')}
  // Siswa badge
  document.getElementById('nb-siswa').textContent=state.siswa.filter(s=>s.status==='Aktif').length;
}

// ---------- AVATAR COLOR ----------
const AVColors=['#4f8ef7','#f7a84f','#34d399','#a78bfa','#f43f5e','#0891b2','#d97706','#7c3aed','#059669','#dc2626'];
function avColor(name){const c=name.charCodeAt(0)%AVColors.length;return AVColors[c]}
function avInitial(name){const w=name.trim().split(' ');return w.length>1?w[0][0]+w[w.length-1][0]:name.slice(0,2).toUpperCase()}

// ---------- SCORE COLOR ----------
function scoreColor(v,kkm=75){if(v>=90)return 'sh';if(v>=kkm)return 'sm';return 'sl'}
function predikat(v){if(v>=90)return '<span class="badge bg-success">A</span>';if(v>=80)return '<span class="badge bg-info">B</span>';if(v>=70)return '<span class="badge bg-warning">C</span>';return '<span class="badge bg-danger">D</span>'}

// ---------- PROFIL ----------
function loadProfil(){
  const p=state.profil,s=state.sekolah;
  const ini=avInitial(p.nama||'GT');
  const col=avColor(p.nama||'G');
  document.getElementById('t-av').textContent=ini;
  document.getElementById('t-av').style.background=`linear-gradient(135deg,${col},${col}cc)`;
  document.getElementById('t-name').textContent=p.nama||'Guru';
  document.getElementById('t-role').textContent=(p.mapel||'Guru')+' · '+s.ta;
}
function renderPengaturan(){
  const p=state.profil,s=state.sekolah;
  ['nama','nip','mapel','hp','email'].forEach(k=>{const el=document.getElementById('set-'+k);if(el)el.value=p[k]||''});
  ['sekolah','npsn','ta','alamat'].forEach(k=>{const el=document.getElementById('set-'+k);if(el)el.value=s[k]||''});
  document.getElementById('set-kkm').value=s.kkm||75;
  if(document.getElementById('set-sem'))document.getElementById('set-sem').value=s.sem||'Genap';
  if(document.getElementById('set-kurk'))document.getElementById('set-kurk').value=s.kurk||'Kurikulum Merdeka';
  const ini=avInitial(p.nama||'GT');
  const col=avColor(p.nama||'G');
  const av=document.getElementById('profil-av');
  av.textContent=ini;av.style.background=`linear-gradient(135deg,${col},${col}cc)`;
  document.getElementById('profil-nama-disp').textContent=p.nama||'-';
  document.getElementById('profil-nip-disp').textContent='NIP: '+(p.nip||'-');
  renderAlarmStatusBadge();
  renderNotifPermStatus();
}
function saveProfil(){
  state.profil={
    nama:document.getElementById('set-nama').value,
    nip:document.getElementById('set-nip').value,
    mapel:document.getElementById('set-mapel').value,
    hp:document.getElementById('set-hp').value,
    email:document.getElementById('set-email').value
  };
  saveState();loadProfil();populateAllSelects();toast('Profil berhasil disimpan');renderPengaturan();
}
function saveSekolah(){
  state.sekolah={
    nama:document.getElementById('set-sekolah').value,
    npsn:document.getElementById('set-npsn').value,
    ta:document.getElementById('set-ta').value,
    sem:document.getElementById('set-sem').value,
    kurk:document.getElementById('set-kurk').value,
    kkm:parseInt(document.getElementById('set-kkm').value)||75,
    alamat:document.getElementById('set-alamat').value
  };
  saveState();toast('Data sekolah berhasil disimpan');loadProfil();
}

// ============ KELAS ============
function saveKelas(){
  const id=document.getElementById('kelas-edit-id').value;
  const obj={
    id:id||uid(), nama:document.getElementById('k-nama').value.trim(),
    jenjang:document.getElementById('k-jenjang').value,
    mapel:document.getElementById('k-mapel').value.trim(),
    wali:document.getElementById('k-wali').value.trim(),
    ta:document.getElementById('k-ta').value.trim(),
    ruang:document.getElementById('k-ruang').value.trim(),
    desk:document.getElementById('k-desk').value.trim()
  };
  if(!obj.nama||!obj.mapel){toast('Nama kelas dan mata pelajaran wajib diisi','error');return}
  if(id){const i=state.kelas.findIndex(k=>k.id===id);if(i>=0)state.kelas[i]=obj}
  else state.kelas.push(obj);
  saveState();populateAllSelects();renderKelas();closeModal('modalKelas');
  toast(id?'Kelas diperbarui':'Kelas berhasil ditambahkan');
}
function editKelas(id){
  const k=state.kelas.find(x=>x.id===id);if(!k)return;
  document.getElementById('kelas-edit-id').value=id;
  document.getElementById('k-nama').value=k.nama;document.getElementById('k-mapel').value=k.mapel;
  document.getElementById('k-jenjang').value=k.jenjang||'SD';
  document.getElementById('k-wali').value=k.wali||'';document.getElementById('k-ta').value=k.ta||'';
  document.getElementById('k-ruang').value=k.ruang||'';document.getElementById('k-desk').value=k.desk||'';
  document.getElementById('modalKelasTitle').textContent='Edit Kelas '+k.nama;
  openModal('modalKelas');
}
function hapusKelas(id){
  confirm2('Hapus kelas ini? Data siswa dalam kelas tidak akan terhapus.',()=>{
    state.kelas=state.kelas.filter(k=>k.id!==id);
    saveState();populateAllSelects();renderKelas();toast('Kelas dihapus');
  });
}
function renderKelas(){
  const tbody=document.getElementById('tbl-kelas');
  if(!state.kelas.length){tbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--muted)">Belum ada kelas. Tambah kelas terlebih dahulu.</td></tr>';return}
  const jenjangBadge={SD:'bg-info',SMP:'bg-warning',SMA:'bg-purple'};
  tbody.innerHTML=state.kelas.map(k=>{
    const siswaK=state.siswa.filter(s=>s.kelas===k.id&&s.status==='Aktif');
    const avgNilai=getAvgNilaiKelas(k.id);
    const pctHadir=getAvgHadirKelas(k.id);
    return `<tr>
      <td><span class="badge ${jenjangBadge[k.jenjang]||'bg-gray'}">${k.jenjang||'-'}</span></td>
      <td><b>${k.nama}</b></td>
      <td>${k.mapel}</td>
      <td>${k.wali||'-'}</td>
      <td><span class="badge bg-info">${siswaK.length} siswa</span></td>
      <td><span class="${scoreColor(avgNilai)}">${avgNilai>0?avgNilai.toFixed(1):'-'}</span></td>
      <td><span class="badge ${pctHadir>=90?'bg-success':pctHadir>=75?'bg-warning':'bg-danger'}">${pctHadir}%</span></td>
      <td><div style="display:flex;gap:4px">
        <button class="btn btn-outline btn-sm btn-icon" onclick="editKelas('${k.id}')" title="Edit"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="hapusKelas('${k.id}')" title="Hapus"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`
  }).join('');
}

// ============ SISWA ============
function saveSiswa(){
  const id=document.getElementById('siswa-edit-id').value;
  const obj={
    id:id||uid(),
    nis:document.getElementById('s-nis').value.trim(),
    kelas:document.getElementById('s-kelas').value,
    nama:document.getElementById('s-nama').value.trim(),
    jk:document.getElementById('s-jk').value,
    alamat:document.getElementById('s-alamat').value.trim(),
    status:document.getElementById('s-status').value
  };
  if(!obj.nama||!obj.kelas){toast('Nama dan kelas wajib diisi','error');return}
  if(id){const i=state.siswa.findIndex(s=>s.id===id);if(i>=0)state.siswa[i]=obj}
  else state.siswa.push(obj);
  saveState();populateAllSelects();renderSiswa();closeModal('modalSiswa');
  document.getElementById('siswa-edit-id').value='';
  toast(id?'Data siswa diperbarui':'Siswa berhasil ditambahkan');
}
function editSiswa(id){
  const s=state.siswa.find(x=>x.id===id);if(!s)return;
  document.getElementById('siswa-edit-id').value=id;
  document.getElementById('s-nis').value=s.nis||'';
  document.getElementById('s-kelas').value=s.kelas;
  document.getElementById('s-nama').value=s.nama;
  document.getElementById('s-jk').value=s.jk||'L';
  document.getElementById('s-alamat').value=s.alamat||'';
  document.getElementById('s-status').value=s.status||'Aktif';
  document.getElementById('modalSiswaTitle').textContent='Edit Siswa: '+s.nama;
  openModal('modalSiswa');
}
function hapusSiswa(id){
  const s=state.siswa.find(x=>x.id===id);
  confirm2(`Hapus data siswa "${s?.nama}"?`,()=>{
    state.siswa=state.siswa.filter(s=>s.id!==id);
    saveState();populateAllSelects();renderSiswa();toast('Siswa dihapus');
  });
}
function detailSiswa(id){
  const s=state.siswa.find(x=>x.id===id);if(!s)return;
  const k=state.kelas.find(k=>k.id===s.kelas);
  const avgNilai=getAvgNilaiSiswa(id);
  const abs=getAbsensiSiswa(id);
  const col=avColor(s.nama);
  document.getElementById('detail-siswa-body').innerHTML=`
    <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:16px">
      <div class="av" style="width:56px;height:56px;font-size:18px;background:linear-gradient(135deg,${col},${col}cc);flex-shrink:0">${avInitial(s.nama)}</div>
      <div>
        <div style="font-size:16px;font-weight:800">${s.nama}</div>
        <div style="font-size:12px;color:var(--muted)">NIS: ${s.nis||'-'} · ${k?.nama||'Kelas?'} · ${s.jk==='L'?'Laki-laki':'Perempuan'}</div>
        <span class="badge ${s.status==='Aktif'?'bg-success':'bg-danger'}" style="margin-top:4px">${s.status}</span>
      </div>
    </div>
    <div class="fr2" style="gap:10px;margin-bottom:14px">
      <div style="font-size:12px"><b>Alamat:</b><br>${s.alamat||'-'}</div>
    </div>
    <div class="fr3" style="gap:10px">
      <div class="sc green" style="margin:0"><div class="sc-label">Rata-rata Nilai</div><div class="sc-val">${avgNilai>0?avgNilai.toFixed(1):'-'}</div></div>
      <div class="sc blue" style="margin:0"><div class="sc-label">Total Hadir</div><div class="sc-val">${abs.h}</div></div>
      <div class="sc red" style="margin:0"><div class="sc-label">Total Absen</div><div class="sc-val">${abs.a}</div></div>
    </div>`;
  openModal('modalDetailSiswa');
}
function renderSiswa(){
  const filterKelas=document.getElementById('filterKelasS')?.value||'';
  let list=state.siswa;
  if(filterKelas)list=list.filter(s=>s.kelas===filterKelas);
  const kelas=state.kelas.find(k=>k.id===filterKelas);
  document.getElementById('siswa-sub').textContent=`${list.length} siswa${kelas?' - Kelas '+kelas.nama:''}`;
  const tbody=document.getElementById('tbl-siswa');
  if(!list.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted)">Belum ada data siswa</td></tr>';return}
  tbody.innerHTML=list.map((s,i)=>{
    const k=state.kelas.find(k=>k.id===s.kelas);
    const col=avColor(s.nama);
    return `<tr>
      <td>${i+1}</td><td>${s.nis||'-'}</td>
      <td><div class="av-row"><div class="av" style="background:linear-gradient(135deg,${col},${col}cc)">${avInitial(s.nama)}</div><div><div style="font-weight:700;font-size:12.5px">${s.nama}</div><div style="font-size:10.5px;color:var(--muted)">${k?.nama||'-'}</div></div></div></td>
      <td>${s.jk}</td>
      <td><span class="badge ${s.status==='Aktif'?'bg-success':'bg-danger'}">${s.status}</span></td>
      <td><div style="display:flex;gap:3px">
        <button class="btn btn-outline btn-sm btn-icon" onclick="detailSiswa('${s.id}')" title="Detail"><i class="fas fa-eye"></i></button>
        <button class="btn btn-outline btn-sm btn-icon" onclick="editSiswa('${s.id}')" title="Edit"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="hapusSiswa('${s.id}')" title="Hapus"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`
  }).join('');
}

// ============ JADWAL ============
const HARI_ORDER=['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
function saveJadwal(){
  const id=document.getElementById('jadwal-edit-id').value;
  const obj={
    id:id||uid(),
    hari:document.getElementById('jd-hari').value,
    kelas:document.getElementById('jd-kelas').value,
    mulai:document.getElementById('jd-mulai').value,
    selesai:document.getElementById('jd-selesai').value,
    mapel:document.getElementById('jd-mapel').value.trim(),
    ruang:document.getElementById('jd-ruang').value.trim(),
    materi:document.getElementById('jd-materi').value.trim()
  };
  if(!obj.kelas){toast('Pilih kelas terlebih dahulu','error');return}
  if(id){const i=state.jadwal.findIndex(j=>j.id===id);if(i>=0)state.jadwal[i]=obj}
  else state.jadwal.push(obj);
  saveState();renderJadwal();closeModal('modalJadwal');
  document.getElementById('jadwal-edit-id').value='';
  toast(id?'Jadwal diperbarui':'Jadwal ditambahkan');
}
function hapusJadwal(id){
  confirm2('Hapus jadwal ini?',()=>{state.jadwal=state.jadwal.filter(j=>j.id!==id);saveState();renderJadwal();toast('Jadwal dihapus')});
}
function renderJadwal(){
  renderCalendar();
  const sorted=[...state.jadwal].sort((a,b)=>HARI_ORDER.indexOf(a.hari)-HARI_ORDER.indexOf(b.hari)||(a.mulai||'').localeCompare(b.mulai||''));
  const tbody=document.getElementById('tbl-jadwal');
  if(!sorted.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">Belum ada jadwal</td></tr>';return}
  const hColors={Senin:'bg-info',Selasa:'bg-purple',Rabu:'bg-warning',Kamis:'bg-success',Jumat:'bg-danger',Sabtu:'bg-gray'};
  tbody.innerHTML=sorted.map(j=>{
    const k=state.kelas.find(k=>k.id===j.kelas);
    return `<tr>
      <td><span class="badge ${hColors[j.hari]||'bg-gray'}">${j.hari}</span></td>
      <td>${j.mulai||'?'}–${j.selesai||'?'}</td>
      <td><b>${k?.nama||'-'}</b></td>
      <td>${j.ruang||'-'}</td>
      <td>${j.materi||j.mapel||'-'}</td>
      <td><div style="display:flex;gap:3px">
        <button class="btn btn-danger btn-sm btn-icon" onclick="hapusJadwal('${j.id}')"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`
  }).join('');
}

// Calendar
let calDate=new Date();
function renderCalendar(){
  const yr=state.calYear,mo=state.calMonth;
  const months=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  document.getElementById('cal-month-lbl').textContent=months[mo]+' '+yr;
  const grid=document.getElementById('calGrid');
  const today=new Date();
  let html='<div class="cal-dn">Min</div><div class="cal-dn">Sen</div><div class="cal-dn">Sel</div><div class="cal-dn">Rab</div><div class="cal-dn">Kam</div><div class="cal-dn">Jum</div><div class="cal-dn">Sab</div>';
  const first=new Date(yr,mo,1).getDay();
  const days=new Date(yr,mo+1,0).getDate();
  const prevDays=new Date(yr,mo,0).getDate();
  for(let i=0;i<first;i++)html+=`<div class="cal-day other">${prevDays-first+i+1}</div>`;
  const hariMap={0:'Minggu',1:'Senin',2:'Selasa',3:'Rabu',4:'Kamis',5:'Jumat',6:'Sabtu'};
  for(let d=1;d<=days;d++){
    const dt=new Date(yr,mo,d);
    const isToday=dt.toDateString()===today.toDateString();
    const hariNama=hariMap[dt.getDay()];
    const hasEv=state.jadwal.some(j=>j.hari===hariNama);
    html+=`<div class="cal-day${isToday?' today':''}${hasEv?' has-event':''}">${d}</div>`;
  }
  const rem=(7-(first+days)%7)%7;
  for(let i=1;i<=rem;i++)html+=`<div class="cal-day other">${i}</div>`;
  grid.innerHTML=html;
}
function calPrev(){if(state.calMonth===0){state.calMonth=11;state.calYear--}else state.calMonth--;renderCalendar()}
function calNext(){if(state.calMonth===11){state.calMonth=0;state.calYear++}else state.calMonth++;renderCalendar()}

// ============ ABSENSI ============
function saveAbsensi(){
  const kelas=document.getElementById('absKelas').value;
  const tgl=document.getElementById('absTgl').value;
  if(!kelas){toast('Pilih kelas terlebih dahulu','error');return}
  if(!tgl){toast('Pilih tanggal terlebih dahulu','error');return}
  const key=kelas+'_'+tgl;
  const rows=document.querySelectorAll('#abs-body .abs-row');
  const data={};
  rows.forEach(row=>{
    const sid=row.dataset.sid;
    const sel=row.querySelector('.abs-sel');
    const ket=row.querySelector('.abs-ket');
    data[sid]={status:sel?.value||'Hadir',keterangan:ket?.value||''};
  });
  if(!state.absensi)state.absensi={};
  state.absensi[key]=data;
  saveState();renderAbsensiStats(kelas,tgl);renderRiwayatAbs();
  toast('Absensi berhasil disimpan');updateBadges();
}
function renderAbsensi(){
  const kelas=document.getElementById('absKelas').value;
  const tgl=document.getElementById('absTgl').value;
  const body=document.getElementById('abs-body');
  if(!kelas){body.innerHTML='<div class="empty"><i class="fas fa-chalkboard"></i><p>Pilih kelas terlebih dahulu</p></div>';return}
  const siswaK=state.siswa.filter(s=>s.kelas===kelas&&s.status==='Aktif');
  if(!siswaK.length){body.innerHTML='<div class="empty"><i class="fas fa-users"></i><p>Belum ada siswa di kelas ini</p><small>Tambah siswa di menu Data Siswa</small></div>';return}
  const key=kelas+'_'+tgl;
  const existing=(state.absensi&&state.absensi[key])||{};
  const opts=['Hadir','Tidak Hadir','Izin','Sakit','Terlambat'];
  const optBadge={'Hadir':'abs-h','Tidak Hadir':'abs-a','Izin':'abs-i','Sakit':'abs-s','Terlambat':'abs-t'};
  body.innerHTML=`<div class="tbl-wrap"><table>
    <thead><tr><th>No</th><th>Nama Siswa</th><th>Status Kehadiran</th><th>Keterangan</th></tr></thead>
    <tbody>${siswaK.map((s,i)=>{
      const cur=existing[s.id]||{status:'Hadir',keterangan:''};
      const col=avColor(s.nama);
      return `<tr class="abs-row" data-sid="${s.id}">
        <td>${i+1}</td>
        <td><div class="av-row"><div class="av" style="background:linear-gradient(135deg,${col},${col}cc)">${avInitial(s.nama)}</div><b>${s.nama}</b></div></td>
        <td><select class="fc abs-sel" style="width:130px;padding:5px 8px;font-size:12px">
          ${opts.map(o=>`<option value="${o}" ${cur.status===o?'selected':''}>${o}</option>`).join('')}
        </select></td>
        <td><input class="fc abs-ket" style="font-size:12px;padding:5px 8px" placeholder="Keterangan..." value="${cur.keterangan||''}"></td>
      </tr>`
    }).join('')}</tbody>
  </table></div>`;
  renderAbsensiStats(kelas,tgl);
}
function renderAbsensiStats(kelas,tgl){
  const key=kelas+'_'+tgl;
  const existing=(state.absensi&&state.absensi[key])||{};
  const vals=Object.values(existing);
  const h=vals.filter(v=>v.status==='Hadir').length;
  const a=vals.filter(v=>v.status==='Tidak Hadir').length;
  const i=vals.filter(v=>v.status==='Izin').length;
  const s=vals.filter(v=>v.status==='Sakit').length;
  const t=vals.filter(v=>v.status==='Terlambat').length;
  document.getElementById('abs-stats').innerHTML=`
    <div class="sc green"><div class="sc-label">Hadir</div><div class="sc-val">${h}</div><i class="fas fa-check sc-icon"></i></div>
    <div class="sc red"><div class="sc-label">Absen</div><div class="sc-val">${a}</div><i class="fas fa-times sc-icon"></i></div>
    <div class="sc blue"><div class="sc-label">Izin</div><div class="sc-val">${i}</div><i class="fas fa-file sc-icon"></i></div>
    <div class="sc yellow"><div class="sc-label">Sakit</div><div class="sc-val">${s}</div><i class="fas fa-notes-medical sc-icon"></i></div>`;
}
function renderRiwayatAbs(){
  const kelas=document.getElementById('riwayatAbsKelas')?.value;
  const tbody=document.getElementById('tbl-riwayat-abs');
  if(!tbody)return;
  const prefix=kelas?kelas+'_':'';
  const keys=Object.keys(state.absensi||{}).filter(k=>!kelas||k.startsWith(prefix)).sort().reverse();
  if(!keys.length){tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted)">Belum ada data absensi</td></tr>';return}
  tbody.innerHTML=keys.slice(0,30).map(key=>{
    const vals=Object.values(state.absensi[key]||{});
    const h=vals.filter(v=>v.status==='Hadir').length;
    const a=vals.filter(v=>v.status==='Tidak Hadir').length;
    const iz=vals.filter(v=>v.status==='Izin').length;
    const s=vals.filter(v=>v.status==='Sakit').length;
    const t=vals.filter(v=>v.status==='Terlambat').length;
    const total=vals.length;const pct=total?Math.round(h/total*100):0;
    const tgl=key.split('_').slice(-1)[0];
    return `<tr><td>${tgl}</td><td><span class="badge bg-success">${h}</span></td><td><span class="badge bg-danger">${a}</span></td><td><span class="badge bg-info">${iz}</span></td><td><span class="badge bg-warning">${s}</span></td><td>${t}</td><td><span class="badge ${pct>=90?'bg-success':pct>=75?'bg-warning':'bg-danger'}">${pct}%</span></td></tr>`
  }).join('');
}

// ============ NILAI ============
function getKolom(kelas,jenis){
  const key=kelas+'_'+jenis;
  if(!state.nilaiKolom[key])state.nilaiKolom[key]=[];
  return state.nilaiKolom[key];
}
function tambahKolomNilai(){
  const kelas=document.getElementById('nilaiKelas').value;
  const jenis=document.getElementById('nilaiJenis').value;
  if(!kelas){toast('Pilih kelas terlebih dahulu','error');return}
  const key=kelas+'_'+jenis;
  if(!state.nilaiKolom[key])state.nilaiKolom[key]=[];
  const n=state.nilaiKolom[key].length+1;
  state.nilaiKolom[key].push(jenis+' '+n);
  saveState();renderNilai();
}
function saveNilai(){
  const kelas=document.getElementById('nilaiKelas').value;
  const jenis=document.getElementById('nilaiJenis').value;
  if(!kelas){toast('Pilih kelas','error');return}
  const kolom=getKolom(kelas,jenis);
  const rows=document.querySelectorAll('#nilai-tbl-wrap tbody tr');
  if(!state.nilai)state.nilai={};
  rows.forEach(row=>{
    const sid=row.dataset.sid;if(!sid)return;
    if(!state.nilai[sid])state.nilai[sid]={};
    if(!state.nilai[sid][jenis])state.nilai[sid][jenis]={};
    kolom.forEach(kol=>{
      const inp=row.querySelector(`input[data-kol="${kol}"]`);
      if(inp)state.nilai[sid][jenis][kol]=parseFloat(inp.value)||0;
    });
  });
  saveState();renderNilai();toast('Nilai berhasil disimpan');
}
function renderNilai(){
  const kelas=document.getElementById('nilaiKelas').value;
  const jenis=document.getElementById('nilaiJenis').value;
  document.getElementById('nilai-title').textContent='Nilai '+jenis+' – Kelas '+(state.kelas.find(k=>k.id===kelas)?.nama||'');
  const wrap=document.getElementById('nilai-tbl-wrap');
  if(!kelas){wrap.innerHTML='<div class="empty"><i class="fas fa-chalkboard"></i><p>Pilih kelas terlebih dahulu</p></div>';return}
  const siswaK=state.siswa.filter(s=>s.kelas===kelas&&s.status==='Aktif');
  if(!siswaK.length){wrap.innerHTML='<div class="empty"><i class="fas fa-users"></i><p>Belum ada siswa di kelas ini</p></div>';return}
  const kolom=getKolom(kelas,jenis);
  const kkm=state.sekolah.kkm||75;
  wrap.innerHTML=`<table>
    <thead><tr><th>No</th><th>Nama Siswa</th>${kolom.map(k=>`<th>${k}</th>`).join('')}<th>Rata-rata</th><th>Predikat</th></tr></thead>
    <tbody>${siswaK.map((s,i)=>{
      const nilSiswa=(state.nilai&&state.nilai[s.id]&&state.nilai[s.id][jenis])||{};
      const vals=kolom.map(k=>nilSiswa[k]||0);
      const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
      const col=avColor(s.nama);
      return `<tr data-sid="${s.id}">
        <td>${i+1}</td>
        <td><div class="av-row"><div class="av" style="background:linear-gradient(135deg,${col},${col}cc)">${avInitial(s.nama)}</div><b>${s.nama}</b></div></td>
        ${kolom.map(k=>`<td><input class="si" data-kol="${k}" value="${nilSiswa[k]||''}" type="number" min="0" max="100" oninput="this.closest('tr').querySelector('.avg-cell').textContent=calcRowAvg(this.closest('tr'))"></td>`).join('')}
        <td><span class="val-cell ${scoreColor(avg,kkm)} avg-cell">${avg>0?avg.toFixed(1):'-'}</span></td>
        <td>${predikat(avg)}</td>
      </tr>`
    }).join('')}</tbody>
  </table>`;
}
function calcRowAvg(row){
  const inputs=row.querySelectorAll('.si');
  const vals=[...inputs].map(i=>parseFloat(i.value)||0).filter(v=>v>0);
  if(!vals.length)return '-';
  return (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1);
}

// ============ JURNAL ============
function saveJurnal(){
  const kelas=document.getElementById('j-kelas').value;
  if(!kelas){toast('Pilih kelas','error');return}
  if(!document.getElementById('j-topik').value.trim()){toast('Topik/KD wajib diisi','error');return}
  const obj={
    id:uid(),
    tgl:document.getElementById('j-tgl').value,
    kelas,
    mapel:document.getElementById('j-mapel').value.trim(),
    topik:document.getElementById('j-topik').value.trim(),
    kegiatan:document.getElementById('j-kegiatan').value.trim(),
    metode:document.getElementById('j-metode').value,
    catatan:document.getElementById('j-catatan').value.trim(),
    hadir:document.getElementById('j-hadir').value
  };
  state.jurnal.unshift(obj);
  saveState();renderJurnal();toast('Jurnal berhasil disimpan');
  ['j-topik','j-kegiatan','j-catatan','j-hadir'].forEach(id=>document.getElementById(id).value='');
}
function hapusJurnal(id){
  confirm2('Hapus jurnal ini?',()=>{state.jurnal=state.jurnal.filter(j=>j.id!==id);saveState();renderJurnal();toast('Jurnal dihapus')});
}
function renderJurnal(){
  const filterK=document.getElementById('filterJurnalKelas')?.value;
  let list=state.jurnal;
  if(filterK)list=list.filter(j=>j.kelas===filterK);
  const container=document.getElementById('jurnal-list');
  if(!list.length){container.innerHTML='<div class="empty"><i class="fas fa-book-open"></i><p>Belum ada jurnal</p><small>Tulis jurnal mengajar Anda</small></div>';return}
  const dotColor=['','g','o','p'];
  container.innerHTML='<div class="tl">'+list.map((j,i)=>{
    const k=state.kelas.find(k=>k.id===j.kelas);
    return `<div class="tl-item">
      <div class="tl-dot ${dotColor[i%4]}"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="tl-title">${j.topik}</div>
          <div class="tl-sub">${j.tgl} · ${k?.nama||'-'} · ${j.mapel||'-'} · ${j.metode}</div>
          ${j.kegiatan?`<div style="font-size:11.5px;color:var(--text);margin-top:4px;line-height:1.5">${j.kegiatan}</div>`:''}
          ${j.catatan?`<div style="font-size:11px;color:var(--muted);margin-top:3px;font-style:italic">${j.catatan}</div>`:''}
          ${j.hadir?`<div style="font-size:11px;margin-top:3px"><span class="badge bg-success">Kehadiran: ${j.hadir}%</span></div>`:''}
        </div>
        <button class="btn btn-danger btn-sm btn-icon" onclick="hapusJurnal('${j.id}')" style="flex-shrink:0;margin-left:8px"><i class="fas fa-trash"></i></button>
      </div>
    </div>`
  }).join('')+'</div>';
}

// ============ RPP ============
function generateRPP(){
  const kelas=document.getElementById('rpp-kelas').value;
  const mapel=document.getElementById('rpp-mapel').value.trim();
  const kd=document.getElementById('rpp-kd').value.trim();
  const waktu=document.getElementById('rpp-waktu').value;
  const model=document.getElementById('rpp-model').value;
  const kurk=document.getElementById('rpp-kurikulum').value;
  if(!kelas||!mapel||!kd){toast('Lengkapi semua field terlebih dahulu','error');return}
  const k=state.kelas.find(k=>k.id===kelas);
  const guru=state.profil.nama||'Guru';
  const sekolah=state.sekolah.nama||'Sekolah';
  const rppHTML=`
    <div style="font-family:'Plus Jakarta Sans',sans-serif;max-width:700px;margin:0 auto;font-size:13px;line-height:1.7">
      <div style="text-align:center;border-bottom:2px solid #0f2044;padding-bottom:14px;margin-bottom:18px">
        <div style="font-weight:800;font-size:18px;color:#0f2044">RENCANA PELAKSANAAN PEMBELAJARAN</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px">${kurk} · ${sekolah}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:18px">
        <tr><td style="padding:5px 10px;width:35%;font-weight:700;background:#f8fafc;border:1px solid #e2e8f0">Satuan Pendidikan</td><td style="padding:5px 10px;border:1px solid #e2e8f0">${sekolah}</td></tr>
        <tr><td style="padding:5px 10px;font-weight:700;background:#f8fafc;border:1px solid #e2e8f0">Mata Pelajaran</td><td style="padding:5px 10px;border:1px solid #e2e8f0">${mapel}</td></tr>
        <tr><td style="padding:5px 10px;font-weight:700;background:#f8fafc;border:1px solid #e2e8f0">Kelas / Semester</td><td style="padding:5px 10px;border:1px solid #e2e8f0">${k?.nama||'-'} / ${state.sekolah.sem||'Genap'}</td></tr>
        <tr><td style="padding:5px 10px;font-weight:700;background:#f8fafc;border:1px solid #e2e8f0">Alokasi Waktu</td><td style="padding:5px 10px;border:1px solid #e2e8f0">${waktu}</td></tr>
        <tr><td style="padding:5px 10px;font-weight:700;background:#f8fafc;border:1px solid #e2e8f0">Guru</td><td style="padding:5px 10px;border:1px solid #e2e8f0">${guru}</td></tr>
        <tr><td style="padding:5px 10px;font-weight:700;background:#f8fafc;border:1px solid #e2e8f0">Tanggal</td><td style="padding:5px 10px;border:1px solid #e2e8f0">${new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}</td></tr>
      </table>
      <div style="margin-bottom:14px"><div style="font-weight:800;font-size:13px;color:#0f2044;margin-bottom:6px;border-left:4px solid #4f8ef7;padding-left:8px">A. KOMPETENSI DASAR / TUJUAN PEMBELAJARAN</div>
      <div style="background:#f8fafc;border-radius:8px;padding:12px;font-size:12.5px">${kd}</div></div>
      <div style="margin-bottom:14px"><div style="font-weight:800;font-size:13px;color:#0f2044;margin-bottom:6px;border-left:4px solid #4f8ef7;padding-left:8px">B. MODEL PEMBELAJARAN</div>
      <div style="background:#f8fafc;border-radius:8px;padding:12px">${model}</div></div>
      <div style="margin-bottom:14px"><div style="font-weight:800;font-size:13px;color:#0f2044;margin-bottom:6px;border-left:4px solid #4f8ef7;padding-left:8px">C. LANGKAH-LANGKAH KEGIATAN</div>
      <div style="background:#f8fafc;border-radius:8px;padding:12px">
        <div style="margin-bottom:8px"><b>1. Pendahuluan (10 menit)</b></div>
        <ul style="margin-left:16px;font-size:12px;color:#475569">
          <li>Guru membuka pelajaran dengan salam dan berdoa bersama</li>
          <li>Guru mengecek kehadiran siswa</li>
          <li>Apersepsi: mengaitkan materi dengan pengalaman siswa</li>
          <li>Guru menyampaikan tujuan pembelajaran dan manfaat mempelajari ${kd}</li>
        </ul>
        <div style="margin:8px 0"><b>2. Kegiatan Inti (${parseInt(waktu)*45-20||60} menit) — ${model}</b></div>
        <ul style="margin-left:16px;font-size:12px;color:#475569">
          <li><b>Stimulasi:</b> Guru menyajikan masalah/fenomena terkait ${kd.toLowerCase()}</li>
          <li><b>Identifikasi Masalah:</b> Siswa merumuskan pertanyaan dari fakta yang disajikan</li>
          <li><b>Pengumpulan Data:</b> Siswa berdiskusi kelompok mencari informasi</li>
          <li><b>Pengolahan Data:</b> Siswa mengolah dan menganalisis hasil diskusi</li>
          <li><b>Verifikasi:</b> Siswa mempresentasikan hasil kerja kelompok</li>
          <li><b>Generalisasi:</b> Siswa menyimpulkan dengan bimbingan guru</li>
        </ul>
        <div style="margin:8px 0"><b>3. Penutup (10 menit)</b></div>
        <ul style="margin-left:16px;font-size:12px;color:#475569">
          <li>Guru dan siswa merefleksi kegiatan pembelajaran</li>
          <li>Guru memberikan penguatan materi</li>
          <li>Guru memberikan tugas/PR jika diperlukan</li>
          <li>Guru menutup pelajaran dengan salam</li>
        </ul>
      </div></div>
      <div style="margin-bottom:14px"><div style="font-weight:800;font-size:13px;color:#0f2044;margin-bottom:6px;border-left:4px solid #4f8ef7;padding-left:8px">D. PENILAIAN</div>
      <div style="background:#f8fafc;border-radius:8px;padding:12px;font-size:12px;color:#475569">
        <div>• <b>Penilaian Sikap:</b> Observasi selama proses pembelajaran</div>
        <div>• <b>Penilaian Pengetahuan:</b> Tes tertulis, kuis, tanya jawab</div>
        <div>• <b>Penilaian Keterampilan:</b> Presentasi, laporan, praktikum</div>
        <div>• <b>KKM:</b> ${state.sekolah.kkm||75}</div>
      </div></div>
      <div style="margin-bottom:14px"><div style="font-weight:800;font-size:13px;color:#0f2044;margin-bottom:6px;border-left:4px solid #4f8ef7;padding-left:8px">E. MEDIA & SUMBER BELAJAR</div>
      <div style="background:#f8fafc;border-radius:8px;padding:12px;font-size:12px;color:#475569">
        <div>• Buku Siswa ${mapel} ${kurk}</div>
        <div>• LKPD (Lembar Kerja Peserta Didik)</div>
        <div>• Video pembelajaran / media digital</div>
        <div>• Alat dan bahan praktikum (jika diperlukan)</div>
      </div></div>
      <div style="display:flex;justify-content:space-between;margin-top:30px;font-size:12px">
        <div style="text-align:center">
          <div>Mengetahui,</div>
          <div>Kepala Sekolah</div>
          <div style="margin-top:50px;border-top:1px solid #334155;padding-top:4px">(___________________)</div>
        </div>
        <div style="text-align:center">
          <div>${state.sekolah.ta||'2025/2026'}, ${new Date().toLocaleDateString('id-ID')}</div>
          <div>Guru Mata Pelajaran</div>
          <div style="margin-top:50px;border-top:1px solid #334155;padding-top:4px">${guru}</div>
          <div style="font-size:11px;color:var(--muted)">NIP. ${state.profil.nip||'-'}</div>
        </div>
      </div>
    </div>`;
  document.getElementById('rpp-preview-body').innerHTML=rppHTML;
  document.getElementById('rpp-preview-card').style.display='block';
  document.getElementById('rpp-preview-card').scrollIntoView({behavior:'smooth'});
  window._pendingRPP={kelas,mapel,kd,waktu,model,kurk,html:rppHTML,tgl:new Date().toLocaleDateString('id-ID')};
}
function saveRPP(){
  if(!window._pendingRPP){toast('Generate RPP terlebih dahulu','error');return}
  const obj={id:uid(),...window._pendingRPP};
  state.rpp.unshift(obj);
  saveState();renderRPP();toast('RPP berhasil disimpan');window._pendingRPP=null;
}
function printRPP(){
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>RPP</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet"><style>body{font-family:'Plus Jakarta Sans',sans-serif;padding:30px;color:#1e293b}@media print{}</style></head><body>${document.getElementById('rpp-preview-body').innerHTML}</body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),800);
}
function hapusRPP(id){
  confirm2('Hapus RPP ini?',()=>{state.rpp=state.rpp.filter(r=>r.id!==id);saveState();renderRPP();toast('RPP dihapus')});
}
function renderRPP(){
  document.getElementById('rpp-count').textContent=state.rpp.length+' RPP tersimpan';
  const list=document.getElementById('rpp-list');
  if(!state.rpp.length){list.innerHTML='<div class="empty"><i class="fas fa-file-alt"></i><p>Belum ada RPP</p><small>Generate RPP dengan form di sebelah kiri</small></div>';return}
  list.innerHTML=state.rpp.map(r=>{
    const k=state.kelas.find(k=>k.id===r.kelas);
    return `<div class="rpp-card">
      <div class="rpp-icon" style="background:#dbeafe"><i class="fas fa-file-alt" style="color:var(--accent)"></i></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:12.5px">${r.kd?.slice(0,60)||'RPP'}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${k?.nama||'-'} · ${r.mapel} · ${r.model} · ${r.tgl}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <button class="btn btn-outline btn-sm" onclick="previewRPP('${r.id}')"><i class="fas fa-eye"></i></button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="hapusRPP('${r.id}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>`
  }).join('');
}
function previewRPP(id){
  const r=state.rpp.find(x=>x.id===id);if(!r)return;
  document.getElementById('rpp-preview-body').innerHTML=r.html;
  document.getElementById('rpp-preview-card').style.display='block';
  document.getElementById('rpp-preview-card').scrollIntoView({behavior:'smooth'});
}

// ============ TUGAS ============
function saveTugas(){
  const id=document.getElementById('tugas-edit-id').value;
  const kelas=document.getElementById('tg-kelas').value;
  if(!kelas){toast('Pilih kelas','error');return}
  if(!document.getElementById('tg-judul').value.trim()){toast('Judul wajib diisi','error');return}
  const obj={
    id:id||uid(),
    judul:document.getElementById('tg-judul').value.trim(),
    kelas,
    jenis:document.getElementById('tg-jenis').value,
    tgl:document.getElementById('tg-tgl').value,
    deadline:document.getElementById('tg-deadline').value,
    desk:document.getElementById('tg-desk').value.trim(),
    maxNilai:parseInt(document.getElementById('tg-maxnilai').value)||100
  };
  if(id){const i=state.tugas.findIndex(t=>t.id===id);if(i>=0)state.tugas[i]=obj}
  else state.tugas.push(obj);
  saveState();renderTugas();closeModal('modalTugas');document.getElementById('tugas-edit-id').value='';
  toast(id?'Tugas diperbarui':'Tugas berhasil dibuat');updateBadges();
}
function hapusTugas(id){
  confirm2('Hapus tugas ini?',()=>{state.tugas=state.tugas.filter(t=>t.id!==id);saveState();renderTugas();toast('Tugas dihapus');updateBadges()});
}
function inputNilaiTugas(id){
  const tg=state.tugas.find(t=>t.id===id);if(!tg)return;
  state.editTugasId=id;
  document.getElementById('nilaiTugasTitle').textContent='Nilai: '+tg.judul;
  const siswaK=state.siswa.filter(s=>s.kelas===tg.kelas&&s.status==='Aktif');
  const existing=(state.nilaiTugas&&state.nilaiTugas[id])||{};
  document.getElementById('tbl-nilai-tugas').innerHTML=siswaK.map(s=>{
    const d=existing[s.id]||{status:'Belum',nilai:'',catatan:''};
    return `<tr data-sid="${s.id}">
      <td><b>${s.nama}</b></td>
      <td><select class="fc" style="width:110px;padding:4px 7px;font-size:11.5px" data-field="status">
        <option ${d.status==='Belum'?'selected':''}>Belum</option>
        <option ${d.status==='Sudah'?'selected':''}>Sudah</option>
        <option ${d.status==='Terlambat'?'selected':''}>Terlambat</option>
      </select></td>
      <td><input type="number" class="fc" style="width:80px;padding:4px 7px;font-size:12px" data-field="nilai" value="${d.nilai}" min="0" max="${tg.maxNilai}" placeholder="0-${tg.maxNilai}"></td>
      <td><input class="fc" style="font-size:11.5px;padding:4px 7px" data-field="catatan" value="${d.catatan||''}" placeholder="Catatan..."></td>
    </tr>`
  }).join('');
  openModal('modalNilaiTugas');
}
function saveNilaiTugas(){
  const id=state.editTugasId;if(!id)return;
  if(!state.nilaiTugas)state.nilaiTugas={};
  state.nilaiTugas[id]={};
  document.querySelectorAll('#tbl-nilai-tugas tr').forEach(row=>{
    const sid=row.dataset.sid;if(!sid)return;
    state.nilaiTugas[id][sid]={
      status:row.querySelector('[data-field="status"]').value,
      nilai:parseFloat(row.querySelector('[data-field="nilai"]').value)||0,
      catatan:row.querySelector('[data-field="catatan"]').value
    };
  });
  saveState();renderTugas();closeModal('modalNilaiTugas');toast('Nilai tugas disimpan');
}
function renderTugas(){
  const filterK=document.getElementById('filterTugasKelas')?.value;
  let list=state.tugas;
  if(filterK)list=list.filter(t=>t.kelas===filterK);
  // Stats
  const total=list.length;
  const selesai=list.filter(t=>{const d=new Date(t.deadline);return d<new Date()}).length;
  const aktif=total-selesai;
  const belumNilai=list.filter(t=>!state.nilaiTugas?.[t.id]).length;
  document.getElementById('tugas-stats').innerHTML=`
    <div class="sc blue"><div class="sc-label">Total Tugas</div><div class="sc-val">${total}</div><i class="fas fa-tasks sc-icon"></i></div>
    <div class="sc orange"><div class="sc-label">Aktif</div><div class="sc-val">${aktif}</div><i class="fas fa-clock sc-icon"></i></div>
    <div class="sc green"><div class="sc-label">Selesai</div><div class="sc-val">${selesai}</div><i class="fas fa-check sc-icon"></i></div>
    <div class="sc red"><div class="sc-label">Belum Dinilai</div><div class="sc-val">${belumNilai}</div><i class="fas fa-exclamation sc-icon"></i></div>`;
  const tbody=document.getElementById('tbl-tugas');
  if(!list.length){tbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">Belum ada tugas</td></tr>';return}
  const jenisColors={Tugas:'bg-info','Kuis Online':'bg-purple',Praktikum:'bg-success',Proyek:'bg-warning',PR:'bg-gray'};
  tbody.innerHTML=list.map(t=>{
    const k=state.kelas.find(k=>k.id===t.kelas);
    const nilData=state.nilaiTugas?.[t.id]||{};
    const nilVals=Object.values(nilData);
    const dikumpul=nilVals.filter(v=>v.status!=='Belum').length;
    const nilRata=nilVals.length?nilVals.reduce((a,v)=>a+(v.nilai||0),0)/nilVals.length:0;
    const siswaK=state.siswa.filter(s=>s.kelas===t.kelas&&s.status==='Aktif').length;
    const isExpired=t.deadline&&new Date(t.deadline)<new Date();
    return `<tr>
      <td><div style="font-weight:700;font-size:12.5px">${t.judul}</div><div style="font-size:10.5px;color:var(--muted)">${t.desk?.slice(0,50)||''}</div></td>
      <td>${k?.nama||'-'}</td>
      <td><span class="badge ${jenisColors[t.jenis]||'bg-gray'}">${t.jenis}</span></td>
      <td style="font-size:11.5px">${t.deadline||'-'}</td>
      <td><span class="badge ${dikumpul>=siswaK?'bg-success':dikumpul>0?'bg-warning':'bg-danger'}">${dikumpul}/${siswaK}</span></td>
      <td><span class="${scoreColor(nilRata)}">${nilRata>0?nilRata.toFixed(1):'-'}</span></td>
      <td><span class="badge ${isExpired?'bg-gray':'bg-success'}">${isExpired?'Selesai':'Aktif'}</span></td>
      <td><div style="display:flex;gap:3px">
        <button class="btn btn-primary btn-sm" onclick="inputNilaiTugas('${t.id}')"><i class="fas fa-star"></i> Nilai</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="hapusTugas('${t.id}')"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`
  }).join('');
}

// ============ BANK SOAL ============
function saveSoal(){
  const id=document.getElementById('soal-edit-id').value;
  const obj={
    id:id||uid(),
    mapel:document.getElementById('sl-mapel').value.trim(),
    jenis:document.getElementById('sl-jenis').value,
    tingkat:document.getElementById('sl-tingkat').value,
    kelas:document.getElementById('sl-kelas').value.trim(),
    topik:document.getElementById('sl-topik').value.trim(),
    pertanyaan:document.getElementById('sl-pertanyaan').value.trim(),
    opsiA:document.getElementById('sl-a').value.trim(),
    opsiB:document.getElementById('sl-b').value.trim(),
    opsiC:document.getElementById('sl-c').value.trim(),
    opsiD:document.getElementById('sl-d').value.trim(),
    kunci:document.getElementById('sl-kunci').value,
    jawaban:document.getElementById('sl-jawaban').value.trim()
  };
  if(!obj.pertanyaan||!obj.mapel){toast('Pertanyaan dan mapel wajib diisi','error');return}
  if(id){const i=state.soal.findIndex(s=>s.id===id);if(i>=0)state.soal[i]=obj}
  else state.soal.push(obj);
  saveState();populateAllSelects();renderSoal();closeModal('modalSoal');
  document.getElementById('soal-edit-id').value='';
  toast(id?'Soal diperbarui':'Soal berhasil ditambahkan');updateBadges();
}
function editSoal(id){
  const s=state.soal.find(x=>x.id===id);if(!s)return;
  document.getElementById('soal-edit-id').value=id;
  document.getElementById('sl-mapel').value=s.mapel||'';
  document.getElementById('sl-jenis').value=s.jenis||'PG';
  document.getElementById('sl-tingkat').value=s.tingkat||'Mudah';
  document.getElementById('sl-kelas').value=s.kelas||'';
  document.getElementById('sl-topik').value=s.topik||'';
  document.getElementById('sl-pertanyaan').value=s.pertanyaan||'';
  document.getElementById('sl-a').value=s.opsiA||'';
  document.getElementById('sl-b').value=s.opsiB||'';
  document.getElementById('sl-c').value=s.opsiC||'';
  document.getElementById('sl-d').value=s.opsiD||'';
  document.getElementById('sl-kunci').value=s.kunci||'A';
  document.getElementById('sl-jawaban').value=s.jawaban||'';
  document.getElementById('modalSoalTitle').textContent='Edit Soal';
  openModal('modalSoal');
}
function hapusSoal(id){
  confirm2('Hapus soal ini?',()=>{state.soal=state.soal.filter(s=>s.id!==id);saveState();renderSoal();populateAllSelects();toast('Soal dihapus');updateBadges()});
}
function renderSoal(){
  const fJenis=document.getElementById('filterSoalJenis')?.value;
  const fMapel=document.getElementById('filterSoalMapel')?.value;
  let list=state.soal;
  if(fJenis)list=list.filter(s=>s.jenis===fJenis);
  if(fMapel)list=list.filter(s=>s.mapel===fMapel);
  const pg=list.filter(s=>s.jenis==='PG').length;
  const es=list.filter(s=>s.jenis==='Essay').length;
  const is=list.filter(s=>s.jenis==='Isian').length;
  document.getElementById('soal-stats').innerHTML=`
    <div class="sc blue"><div class="sc-label">Total Soal</div><div class="sc-val">${state.soal.length}</div><i class="fas fa-database sc-icon"></i></div>
    <div class="sc green"><div class="sc-label">Pilihan Ganda</div><div class="sc-val">${pg}</div><i class="fas fa-list sc-icon"></i></div>
    <div class="sc orange"><div class="sc-label">Essay</div><div class="sc-val">${es}</div><i class="fas fa-pen sc-icon"></i></div>
    <div class="sc purple"><div class="sc-label">Isian Singkat</div><div class="sc-val">${is}</div><i class="fas fa-minus sc-icon"></i></div>`;
  const tbody=document.getElementById('tbl-soal');
  if(!list.length){tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">Belum ada soal</td></tr>';return}
  const jColor={'PG':'bg-info','Essay':'bg-warning','Isian':'bg-purple'};
  const tColor={Mudah:'bg-success',Sedang:'bg-warning',Sulit:'bg-danger'};
  tbody.innerHTML=list.map(s=>`<tr>
    <td style="max-width:220px"><div style="font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.pertanyaan}</div>
    ${s.jenis==='PG'&&s.kunci?`<div style="font-size:10px;color:var(--muted);margin-top:2px">Kunci: ${s.kunci} — ${s['opsi'+s.kunci]||''}</div>`:''}
    </td>
    <td><span style="font-size:11.5px">${s.topik||'-'}</span></td>
    <td><span class="badge ${jColor[s.jenis]||'bg-gray'}">${s.jenis}</span></td>
    <td><span class="badge ${tColor[s.tingkat]||'bg-gray'}">${s.tingkat}</span></td>
    <td>${s.kelas||'-'}</td>
    <td>${s.mapel||'-'}</td>
    <td><div style="display:flex;gap:3px">
      <button class="btn btn-outline btn-sm btn-icon" onclick="editSoal('${s.id}')"><i class="fas fa-edit"></i></button>
      <button class="btn btn-danger btn-sm btn-icon" onclick="hapusSoal('${s.id}')"><i class="fas fa-trash"></i></button>
    </div></td>
  </tr>`).join('');
}

// ============ ANALITIK ============
function renderAnalitik(){
  const kelas=document.getElementById('analitikKelas')?.value;
  const siswaK=kelas?state.siswa.filter(s=>s.kelas===kelas&&s.status==='Aktif'):state.siswa.filter(s=>s.status==='Aktif');
  const kkm=state.sekolah.kkm||75;
  // Stats
  const totSiswa=siswaK.length;
  const avgNilai=totSiswa?siswaK.reduce((a,s)=>a+getAvgNilaiSiswa(s.id),0)/totSiswa:0;
  const bawahKKM=siswaK.filter(s=>getAvgNilaiSiswa(s.id)>0&&getAvgNilaiSiswa(s.id)<kkm).length;
  const avgHadir=kelas?getAvgHadirKelas(kelas):0;
  document.getElementById('analitik-stats').innerHTML=`
    <div class="sc blue"><div class="sc-label">Total Siswa</div><div class="sc-val">${totSiswa}</div><i class="fas fa-users sc-icon"></i></div>
    <div class="sc green"><div class="sc-label">Rata-rata Nilai</div><div class="sc-val">${avgNilai>0?avgNilai.toFixed(1):'-'}</div><i class="fas fa-star sc-icon"></i></div>
    <div class="sc red"><div class="sc-label">Bawah KKM (${kkm})</div><div class="sc-val">${bawahKKM}</div><i class="fas fa-exclamation sc-icon"></i></div>`;
  // Distribusi
  const A=siswaK.filter(s=>getAvgNilaiSiswa(s.id)>=90).length;
  const B=siswaK.filter(s=>{const v=getAvgNilaiSiswa(s.id);return v>=80&&v<90}).length;
  const C=siswaK.filter(s=>{const v=getAvgNilaiSiswa(s.id);return v>=kkm&&v<80}).length;
  const D=siswaK.filter(s=>getAvgNilaiSiswa(s.id)>0&&getAvgNilaiSiswa(s.id)<kkm).length;
  const tot=A+B+C+D;
  document.getElementById('dist-nilai').innerHTML=tot?[
    {lbl:`A (90-100) — ${A} siswa`,pct:Math.round(A/tot*100),cls:'pb-green'},
    {lbl:`B (80-89) — ${B} siswa`,pct:Math.round(B/tot*100),cls:'pb-blue'},
    {lbl:`C (${kkm}-79) — ${C} siswa`,pct:Math.round(C/tot*100),cls:'pb-orange'},
    {lbl:`D (<${kkm}) — Perlu Remedial — ${D} siswa`,pct:Math.round(D/tot*100),cls:'pb-red'}
  ].map(d=>`<div style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span>${d.lbl}</span><span style="font-weight:700">${d.pct}%</span></div>
    <div class="prog"><div class="prog-bar ${d.cls}" style="width:${d.pct}%"></div></div>
  </div>`).join(''):'<div class="empty"><i class="fas fa-chart-pie"></i><p>Belum ada data nilai</p></div>';
  // Perhatian
  const perhatian=siswaK.filter(s=>{
    const avg=getAvgNilaiSiswa(s.id);
    const abs=getAbsensiSiswa(s.id);
    return (avg>0&&avg<kkm)||(abs.a>=5);
  }).slice(0,8);
  document.getElementById('perhatian-list').innerHTML=perhatian.length?perhatian.map(s=>{
    const avg=getAvgNilaiSiswa(s.id);
    const abs=getAbsensiSiswa(s.id);
    const isBawah=avg>0&&avg<kkm;
    return `<div style="padding:10px 12px;background:${isBawah?'#fff7ed':'#fef2f2'};border-radius:8px;border-left:3px solid ${isBawah?'var(--accent2)':'var(--danger)'};margin-bottom:8px">
      <div style="font-size:12.5px;font-weight:700">${s.nama}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">
        ${avg>0?'Nilai: '+avg.toFixed(1)+' (bawah KKM '+kkm+')':'Nilai belum ada'}${abs.a>=5?' · Absen '+abs.a+'x':''}
      </div>
    </div>`
  }).join(''):'<div class="empty"><i class="fas fa-check-circle"></i><p>Semua siswa di atas KKM</p></div>';
  // Trend hadir (dummy per bulan dari data absensi)
  const months=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const hdMap={};
  Object.entries(state.absensi||{}).forEach(([key,val])=>{
    if(kelas&&!key.startsWith(kelas+'_'))return;
    const tgl=key.split('_').slice(-1)[0];
    if(!tgl)return;
    const mo=new Date(tgl).getMonth();
    if(!hdMap[mo])hdMap[mo]={h:0,t:0};
    const v=Object.values(val);
    hdMap[mo].h+=v.filter(x=>x.status==='Hadir').length;
    hdMap[mo].t+=v.length;
  });
  const now=new Date();
  const last6=[];for(let i=5;i>=0;i--){const m=(now.getMonth()-i+12)%12;last6.push({mo:m,lbl:months[m],pct:hdMap[m]?Math.round(hdMap[m].h/hdMap[m].t*100):0})}
  const maxH=Math.max(...last6.map(x=>x.pct),1);
  document.getElementById('trend-hadir').innerHTML=`<div class="bar-chart" style="height:100px;gap:10px">`+
    last6.map(d=>`<div class="bar-col">
      <div class="bar-val">${d.pct?d.pct+'%':'-'}</div>
      <div class="bar" style="height:${d.pct?d.pct/maxH*90:3}%;background:${d.pct>=90?'var(--success)':d.pct>=75?'var(--accent)':'var(--danger)'}"></div>
      <div class="bar-lbl">${d.lbl}</div>
    </div>`).join('')+'</div>';
}

// ============ DASHBOARD ============
function renderDashboard(){
  const totSiswa=state.siswa.filter(s=>s.status==='Aktif').length;
  const today=new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('dash-tanggal').textContent=today;
  // Stats
  const tglToday=toDateStr(new Date());
  let hdToday=0,totToday=0;
  state.kelas.forEach(k=>{
    const key=k.id+'_'+tglToday;
    const d=state.absensi?.[key]||{};
    const v=Object.values(d);
    hdToday+=v.filter(x=>x.status==='Hadir').length;
    totToday+=state.siswa.filter(s=>s.kelas===k.id&&s.status==='Aktif').length;
  });
  const tugasAktif=state.tugas.filter(t=>!t.deadline||new Date(t.deadline)>=new Date()).length;
  const avgNilaiAll=state.siswa.filter(s=>s.status==='Aktif').reduce((a,s)=>{const v=getAvgNilaiSiswa(s.id);return a+(v||0)},0)/Math.max(state.siswa.filter(s=>s.status==='Aktif').length,1);
  document.getElementById('dash-stats').innerHTML=`
    <div class="sc blue"><div class="sc-label">Total Siswa Aktif</div><div class="sc-val">${totSiswa}</div><div class="sc-change">${state.kelas.length} kelas</div><i class="fas fa-users sc-icon"></i></div>
    <div class="sc green"><div class="sc-label">Hadir Hari Ini</div><div class="sc-val">${hdToday}</div><div class="sc-change">${totToday?Math.round(hdToday/totToday*100):0}% kehadiran</div><i class="fas fa-clipboard-check sc-icon"></i></div>
    <div class="sc orange"><div class="sc-label">Rata-rata Nilai</div><div class="sc-val">${avgNilaiAll>0?avgNilaiAll.toFixed(1):'-'}</div><div class="sc-change">${state.sekolah.kkm?'KKM: '+state.sekolah.kkm:''}</div><i class="fas fa-star sc-icon"></i></div>
    <div class="sc purple"><div class="sc-label">Tugas Aktif</div><div class="sc-val">${tugasAktif}</div><div class="sc-change">${state.tugas.length} total</div><i class="fas fa-tasks sc-icon"></i></div>`;
  // Jadwal hari ini
  const hariMap={0:'Minggu',1:'Senin',2:'Selasa',3:'Rabu',4:'Kamis',5:'Jumat',6:'Sabtu'};
  const hariIni=hariMap[new Date().getDay()];
  const jadwalHariIni=state.jadwal.filter(j=>j.hari===hariIni).sort((a,b)=>(a.mulai||'').localeCompare(b.mulai||''));
  const dotColors=['','g','o','p'];
  if(jadwalHariIni.length){
    document.getElementById('dash-jadwal-list').innerHTML='<div class="tl">'+jadwalHariIni.map((j,i)=>{
      const k=state.kelas.find(k=>k.id===j.kelas);
      return `<div class="tl-item"><div class="tl-dot ${dotColors[i%4]}"></div>
        <div class="tl-title">${j.mapel||k?.mapel||'Pelajaran'} – ${k?.nama||'-'}</div>
        <div class="tl-sub">${j.mulai||'?'} – ${j.selesai||'?'} · ${j.ruang||'-'} · ${j.materi||'-'}</div>
      </div>`
    }).join('')+'</div>';
  }
  // Notif
  const notifs=[];
  // Absen tanpa keterangan
  state.kelas.forEach(k=>{
    const key=k.id+'_'+tglToday;
    const d=state.absensi?.[key]||{};
    const tanpaKet=Object.entries(d).filter(([,v])=>v.status==='Tidak Hadir'&&!v.keterangan).map(([sid])=>state.siswa.find(s=>s.id===sid)?.nama||'?');
    if(tanpaKet.length)notifs.push({type:'danger',msg:`<b>${tanpaKet.length} siswa absen</b> tanpa keterangan di kelas ${k.nama}: ${tanpaKet.slice(0,3).join(', ')}`});
  });
  // Tugas deadline
  state.tugas.forEach(t=>{
    if(t.deadline){const dl=new Date(t.deadline);const diff=Math.ceil((dl-new Date())/(1000*60*60*24));if(diff>=0&&diff<=3)notifs.push({type:'warn',msg:`<b>Deadline tugas</b> "${t.judul}" ${diff===0?'hari ini':diff===1?'besok':'dalam '+diff+' hari'}`})}
  });
  if(!notifs.length)notifs.push({type:'success',msg:'Semua baik! Tidak ada notifikasi saat ini.'});
  document.getElementById('dash-notif-count').textContent=notifs.length+' notifikasi';
  document.getElementById('dash-notif').innerHTML=notifs.map(n=>`<div class="alert al-${n.type}"><i class="fas ${n.type==='danger'?'fa-exclamation-circle':n.type==='warn'?'fa-clock':n.type==='info'?'fa-envelope':'fa-check-circle'}"></i><div>${n.msg}</div></div>`).join('');
  // Top 5
  const ranked=state.siswa.filter(s=>s.status==='Aktif').map(s=>({...s,avg:getAvgNilaiSiswa(s.id)})).filter(s=>s.avg>0).sort((a,b)=>b.avg-a.avg).slice(0,5);
  const medals=['🥇','🥈','🥉','4️⃣','5️⃣'];
  if(ranked.length){
    document.getElementById('dash-top5').innerHTML='<div style="display:flex;flex-direction:column;gap:10px">'+ranked.map((s,i)=>{
      const col=avColor(s.nama);
      return `<div style="display:flex;align-items:center;gap:9px">
        <span style="font-size:15px;width:22px">${medals[i]}</span>
        <div class="av" style="background:linear-gradient(135deg,${col},${col}cc)">${avInitial(s.nama)}</div>
        <div style="flex:1"><div style="font-size:12px;font-weight:700">${s.nama}</div><div class="prog" style="margin-top:4px"><div class="prog-bar pb-orange" style="width:${s.avg}%"></div></div></div>
        <div style="font-size:13px;font-weight:800;color:var(--accent2)">${s.avg.toFixed(1)}</div>
      </div>`
    }).join('')+'</div>';
  } else {
    document.getElementById('dash-top5').innerHTML='<div class="empty"><i class="fas fa-trophy"></i><p>Belum ada data nilai</p></div>';
  }
  // Kehadiran per kelas
  if(state.kelas.length){
    document.getElementById('dash-kehadiran').innerHTML='<div style="display:flex;flex-direction:column;gap:10px">'+state.kelas.map(k=>{
      const pct=getAvgHadirKelas(k.id);
      return `<div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span><b>${k.nama}</b> (${k.mapel})</span><span class="badge ${pct>=90?'bg-success':pct>=75?'bg-warning':'bg-danger'}">${pct}%</span></div><div class="prog"><div class="prog-bar ${pct>=90?'pb-green':pct>=75?'pb-blue':'pb-red'}" style="width:${pct}%"></div></div></div>`
    }).join('')+'</div>';
  } else {
    document.getElementById('dash-kehadiran').innerHTML='<div class="empty"><i class="fas fa-chart-bar"></i><p>Belum ada data kelas</p></div>';
  }
}

// ============ HELPER FUNCTIONS ============
function getAvgNilaiSiswa(sid){
  const n=state.nilai?.[sid]||{};
  const semua=[];
  ['UH','UTS','UAS','TUGAS'].forEach(j=>{semua.push(...Object.values(n[j]||{}))});
  return semua.length?semua.reduce((a,b)=>a+b,0)/semua.length:0;
}
function getAvgNilaiKelas(kelasId){
  const siswaK=state.siswa.filter(s=>s.kelas===kelasId&&s.status==='Aktif');
  const avgs=siswaK.map(s=>getAvgNilaiSiswa(s.id)).filter(v=>v>0);
  return avgs.length?avgs.reduce((a,b)=>a+b,0)/avgs.length:0;
}
function getAvgHadirKelas(kelasId){
  const keys=Object.keys(state.absensi||{}).filter(k=>k.startsWith(kelasId+'_'));
  if(!keys.length)return 0;
  let totalH=0,totalT=0;
  keys.forEach(k=>{const v=Object.values(state.absensi[k]);totalH+=v.filter(x=>x.status==='Hadir').length;totalT+=v.length});
  return totalT?Math.round(totalH/totalT*100):0;
}
function getAbsensiSiswa(sid){
  let h=0,a=0,i=0,s=0,t=0;
  Object.values(state.absensi||{}).forEach(d=>{
    if(d[sid]){const st=d[sid].status;if(st==='Hadir')h++;else if(st==='Tidak Hadir')a++;else if(st==='Izin')i++;else if(st==='Sakit')s++;else if(st==='Terlambat')t++}
  });
  return {h,a,i,s,t};
}

// ============ BADGE UPDATE ============
function updateBadges(){
  const nbSoal=document.getElementById('nb-soal');if(nbSoal)nbSoal.textContent=state.soal.length;
  const nbSiswa=document.getElementById('nb-siswa');if(nbSiswa)nbSiswa.textContent=state.siswa.filter(s=>s.status==='Aktif').length;
  // Tugas belum dinilai
  const belumNilai=state.tugas.filter(t=>!state.nilaiTugas?.[t.id]).length;
  const nbTugas=document.getElementById('nb-tugas');
  if(nbTugas){nbTugas.textContent=belumNilai;nbTugas.style.display=belumNilai?'inline':'none'}
}

// ============ EXPORT ============
function downloadCSV(csv,filename){
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
  toast('File CSV berhasil diunduh');
}
function exportSiswaCSV(){
  let csv='No,NIS,Nama,Kelas,L/P,Status\n';
  state.siswa.forEach((s,i)=>{
    const k=state.kelas.find(k=>k.id===s.kelas);
    csv+=`${i+1},${s.nis||''},${s.nama},${k?.nama||''},${s.jk},${s.status}\n`;
  });
  downloadCSV(csv,'data_siswa.csv');
}
function exportRekapNilai(){
  let csv='No,Nama,Kelas,UH,UTS,UAS,Tugas,Nilai Akhir\n';
  state.siswa.filter(s=>s.status==='Aktif').forEach((s,i)=>{
    const k=state.kelas.find(k=>k.id===s.kelas);
    const n=state.nilai?.[s.id]||{};
    const getAvg=j=>{const v=Object.values(n[j]||{});return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
    const avgs=[getAvg('UH'),getAvg('UTS'),getAvg('UAS'),getAvg('TUGAS')].filter(v=>v!==null);
    const final=avgs.length?avgs.reduce((a,b)=>a+b,0)/avgs.length:0;
    csv+=`${i+1},"${s.nama}","${k?.nama||'-'}",${getAvg('UH')?.toFixed(1)||'-'},${getAvg('UTS')?.toFixed(1)||'-'},${getAvg('UAS')?.toFixed(1)||'-'},${getAvg('TUGAS')?.toFixed(1)||'-'},${final?final.toFixed(1):'-'}\n`;
  });
  downloadCSV(csv,'rekap_nilai.csv');
}
function printAbsensiRekap(){
  const w=window.open('','_blank');
  const keys=Object.keys(state.absensi||{}).sort().reverse().slice(0,30);
  const rows=keys.map(key=>{
    const v=Object.values(state.absensi[key]||{});
    const h=v.filter(x=>x.status==='Hadir').length,a=v.filter(x=>x.status==='Tidak Hadir').length;
    const pct=v.length?Math.round(h/v.length*100):0;
    return `<tr><td>${key.split('_').slice(-1)[0]}</td><td>${h}</td><td>${a}</td><td>${v.filter(x=>x.status==='Izin').length}</td><td>${v.filter(x=>x.status==='Sakit').length}</td><td>${pct}%</td></tr>`;
  }).join('');
  w.document.write(`<!DOCTYPE html><html><head><title>Rekap Absensi</title><style>body{font-family:Arial;padding:30px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:7px 10px;font-size:12px}th{background:#f5f5f5}</style></head><body><h2>Rekap Absensi</h2><table><thead><tr><th>Tanggal</th><th>Hadir</th><th>Absen</th><th>Izin</th><th>Sakit</th><th>%</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),600);
}
function printJurnal(){
  const w=window.open('','_blank');
  const rows=state.jurnal.map(j=>{
    const k=state.kelas.find(k=>k.id===j.kelas);
    return `<tr><td>${j.tgl}</td><td>${k?.nama||'-'}</td><td>${j.mapel||'-'}</td><td>${j.topik}</td><td>${j.metode}</td><td>${j.hadir?j.hadir+'%':'-'}</td></tr>`;
  }).join('');
  w.document.write(`<!DOCTYPE html><html><head><title>Jurnal Mengajar</title><style>body{font-family:Arial;padding:30px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:7px;font-size:12px}th{background:#f5f5f5}</style></head><body><h2>Jurnal Mengajar</h2><p>Guru: ${state.profil.nama||'-'}</p><table><thead><tr><th>Tanggal</th><th>Kelas</th><th>Mapel</th><th>Topik</th><th>Metode</th><th>Hadir</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),600);
}

// ============ GLOBAL SEARCH ============
function globalSearchFn(q){
  if(!q.trim())return;
  q=q.toLowerCase();
  const found=state.siswa.find(s=>s.nama.toLowerCase().includes(q));
  if(found){nav('siswa');setTimeout(()=>{document.getElementById('filterKelasS').value='';renderSiswa()},100)}
}

// ============ RESET ============
function resetData(){
  confirm2('RESET SEMUA DATA? Tindakan ini tidak bisa dibatalkan dan akan menghapus semua data aplikasi.',async ()=>{
    showAppLoading(true);
    await Promise.all(['kelas','siswa','jadwal','absensi','nilai','jurnal','rpp','tugas','nilaiTugas','soal','nilaiKolom'].map(k=>DB.del(k)));
    location.reload();
  });
}

// ============ SOAL JENIS TOGGLE ============
document.getElementById('sl-jenis').addEventListener('change',function(){
  document.getElementById('sl-opsi-wrap').style.display=this.value==='PG'?'block':'none';
});

// ============ START — AUTH GUARD ============
auth.onAuthStateChanged(async (user)=>{
  if(!user){
    window.location.href='login.html';
    return;
  }
  try{
    const docSnap=await db.collection('users').doc(user.uid).get();
    if(!docSnap.exists||docSnap.data().isApproved!==true){
      await auth.signOut();
      window.location.href='login.html';
      return;
    }
    _currentUid=user.uid;
    const userData=docSnap.data();
    document.getElementById('userBarEmail').textContent=userData.email||user.email;
    init();
  }catch(e){
    console.error('Auth guard gagal:',e);
    showAppLoading(false);
    toast('Gagal memverifikasi akun. Coba muat ulang halaman.','error');
  }
});

function showAppLoading(show){
  const el=document.getElementById('appLoadingOverlay');
  if(el)el.style.display=show?'flex':'none';
}

function doAppLogout(){
  confirm2('Keluar dari akun ini?',async ()=>{
    await auth.signOut();
    window.location.href='login.html';
  });
}
