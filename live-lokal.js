// live-lokal.js — pengganti live-client.js: menjalankan engine.js langsung di browser (tanpa server/TikTok).
// Antarmuka Live sama dengan yang dipakai layar: on, onApp, api.
(function () {
  const CFG = { jatahJawaban: 99, durasiDefault: 30, jedaSiapRonde: 6, poinDasar: 100, pengaliMaks: 2.5,
                tampilKlasemen: 5, judulAcara: 'Kuis Kelas 5 SD', otomatis: false };
  const KEY = 'kuis-sd5:v1', NAMA = 'kuis-sd5:nama';
  const h = { app: {}, on: {} };
  const Live = {
    onApp(e, f) { (h.app[e] = h.app[e] || []).push(f); },
    on(e, f) { (h.on[e] = h.on[e] || []).push(f); if (e === 'status') f({ alasan: null }); },
    api(aksi, o) { return Live._api(aksi, (o && o.body) || {}); },
    _api: () => Promise.reject(new Error('belum siap')),
  };
  window.Live = Live;
  let engine = null, soalData = null;
  let T; try { T = JSON.parse(localStorage.getItem(KEY + ':rapor')) || null; } catch { T = null; }
  T = T || { r: {}, terakhir: null };
  const simpanT = () => { try { localStorage.setItem(KEY + ':rapor', JSON.stringify(T)); } catch { /* abaikan */ } };
  const tally = (d) => { // hitung benar per ronde sekali per soal (aman dari render ulang / refresh)
    if (d.status !== 'HASIL' || !d.hasil) return;
    const k = d.ronde.nomor + ':' + d.soal.nomor;
    if (T.terakhir === k) return;
    T.terakhir = k; if (d.hasil.totalBenar) T.r[d.ronde.nomor] = (T.r[d.ronde.nomor] || 0) + 1; simpanT();
  };
  const rapor = () => {
    const pl = engine.ambilState().pengguna.pemain;
    const ronde = soalData.ronde.map((r, i) => ({ judul: r.judul, benar: T.r[i + 1] || 0, jumlah: r.soal.length }));
    return { nama: localStorage.getItem(NAMA) || 'Pemain', poin: pl ? pl.total : 0, ronde,
      jawab: (engine.ambilState().jawaban.pemain || {}).huruf || null,
      benar: ronde.reduce((a, x) => a + x.benar, 0), total: ronde.reduce((a, x) => a + x.jumlah, 0) };
  };
  const keluar = (e, d) => { if (e === 'state') { tally(d); d.rapor = rapor(); } (h.app[e] || []).forEach((f) => f(d)); };

  const bus = (() => { const m = {}; return {
    on: (e, f) => (m[e] = m[e] || []).push(f),
    off: (e, f) => { m[e] = (m[e] || []).filter((x) => x !== f); },
    emit: (e, d) => (m[e] || []).forEach((f) => f(d)) }; })();
  const store = {
    muat() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
    simpan(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* penuh/diblokir */ } },
  };

  // Layar sambutan (#masuk di index.html): nama ditanya sekali, lalu diingat di browser.
  function mintaNama() {
    const ada = (localStorage.getItem(NAMA) || '').trim();
    if (ada) return Promise.resolve(ada);
    return new Promise((selesai) => {
      const w = document.getElementById('masuk'), i = document.getElementById('masukNama'), g = document.getElementById('masukGo');
      const jalan = () => {
        const n = i.value.trim().slice(0, 14); if (!n) return;
        try { localStorage.setItem(NAMA, n); } catch { /* abaikan */ }
        w.hidden = true; selesai(n);
      };
      i.oninput = () => { g.disabled = !i.value.trim(); };
      i.onkeydown = (e) => { if (e.key === 'Enter') jalan(); };
      g.onclick = jalan;
      w.hidden = false; setTimeout(() => i.focus(), 300);
    });
  }

  Promise.all([import('./js/engine.js'), fetch('data/soal.json').then((r) => r.json())]).then(async ([m, sd]) => {
    const nama = await mintaNama();
    soalData = sd; engine = m.buatEngine({
      soalData, cfg: CFG, bus, store, mode: 'live',
      cocokkan: (teks) => ({ status: 'jawaban', huruf: teks }),
      kirim: (e, d) => keluar(e, d), log: () => {},
    });
    const aksi = {
      state: () => { const d = engine.publik(); d.rapor = rapor(); return d; },
      mulai: () => engine.mulai(), kunci: () => engine.kunci(), lanjut: () => engine.lanjut(),
      lewati: () => engine.lewati(),
      ulang: () => { T = { r: {}, terakhir: null }; simpanT(); engine.reset(); return true; },
      pilih: ({ huruf }) => { // memilih = mencatat jawaban; dikunci lewat tombol "Yakin" (atau saat waktu habis)
        if (engine.status() !== 'BERJALAN') return false;
        bus.emit('komentar', { userId: 'pemain', nama, teks: huruf, waktuTerima: Date.now() });
        return true;
      },
    };
    Live._api = (a, b) => Promise.resolve(aksi[a](b));
    (h.on.app || []).forEach((f) => f());
  });
})();
