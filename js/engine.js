// engine.js — mesin status kuis (M3) + persistensi (M4).
// SIAP -> BERJALAN -> HASIL -> (SIAP soal berikutnya | RONDE_SELESAI | SESI_SELESAI)
// Engine tidak tahu asal komentar: ia hanya mendengarkan 'komentar' di bus.
import { hitungPoin, urutKlasemen } from './scoring.js';

const SEMUA_STATUS = ['SIAP', 'BERJALAN', 'HASIL', 'RONDE_SELESAI', 'SESI_SELESAI'];

export function buatEngine({
  soalData, cfg, aliasGlobal = {}, cocokkan, bus, kirim = () => {},
  store = null, mode = 'sim', baru = false, log = console.log,
}) {
  const ronde = soalData.ronde;
  const C = {
    poinDasar: 100, faktorMin: 0.5, pengaliLangkah: 0.25, pengaliMaks: 2.5,
    jedaHasil: 8, jedaSiap: 3, jedaRonde: 12, tampilKlasemen: 5, lencanaMin: 3,
    jatahJawaban: 3, durasiDefault: 20, judulAcara: 'Kuis LIVE', ...cfg,
  };
  const opsiCocok = { ambang: cfg.ambang, maksKata: cfg.maksKata, aliasGlobal };

  const barui = () => ({
    versi: 1, mode, status: 'SIAP', r: 0, s: 0, mulaiMs: null, akhirMs: null,
    jawaban: {}, pengguna: {}, hasil: null, klasemen: { sesi: [], ronde: [] }, otomatis: false,
  });

  let S = barui();
  let pewaktu = null, tundaStats = null, tundaSimpan = null, tundaOtomatis = null, sisaTerakhir = -1;
  let otoAkhirMs = null; // K5: kapan aksi otomatis berikutnya jalan (null = tidak ada), untuk hitung mundur di layar

  // ---- Muat state tersimpan (M4) ----
  if (store && !baru) {
    const t = store.muat();
    const sah = t && t.versi === 1 && SEMUA_STATUS.includes(t.status)
      && ronde[t.r] && ronde[t.r].soal[t.s];
    if (sah && t.mode === mode) {
      S = { ...barui(), ...t };
      log(`[engine] state dilanjutkan: ${Object.keys(S.pengguna).length} pemain, ronde ${S.r + 1}, soal ${S.s + 1}, status ${S.status}. (Mulai dari nol: tombol Reset sesi di panel host)`);
    } else if (t) {
      log(t.mode !== mode
        ? `[engine] state lama berasal dari mode "${t.mode}", sekarang "${mode}": mulai dari nol.`
        : '[engine] state lama tidak cocok dengan soal.json: mulai dari nol.');
    }
  }

  const soalSaatIni = () => ronde[S.r].soal[S.s];
  const durasiSoal = () => soalSaatIni().durasi || C.durasiDefault;

  function sisaDetik() {
    if (S.status === 'BERJALAN') return Math.max(0, Math.ceil((S.akhirMs - Date.now()) / 1000));
    if (S.status === 'SIAP') return durasiSoal();
    return 0;
  }

  // ---- Klasemen ----
  function hitungKlasemen() {
    const rid = ronde[S.r].id;
    const sesi = [], rnd = [];
    for (const [id, p] of Object.entries(S.pengguna)) {
      const dasar = { id, nama: p.nama, avatar: p.avatar, streak: p.streak };
      if (p.total > 0) sesi.push({ ...dasar, poin: p.total, waktu: p.waktuBenar });
      const pr = p.ronde && p.ronde[rid];
      if (pr && pr.poin > 0) rnd.push({ ...dasar, poin: pr.poin, waktu: pr.waktuBenar });
    }
    const n = C.tampilKlasemen;
    // K2: peringkat sekarang, perubahan sejak soal sebelumnya (naik > 0, turun < 0, null = baru/tanpa data),
    // dan selisih poin ke peringkat tepat di atasnya (0 untuk juara).
    const urutSesi = urutKlasemen(sesi).map((p, i, arr) => {
      const lalu = S.pengguna[p.id].peringkatLalu;
      return { ...p, peringkat: i + 1, naik: lalu ? lalu - (i + 1) : null, selisih: i > 0 ? arr[i - 1].poin - p.poin : 0 };
    });
    S.klasemen = { sesi: urutSesi.slice(0, n), ronde: urutKlasemen(rnd).slice(0, n) };
  }

  // ---- Siaran ke layar ----
  function publik() {
    const so = soalSaatIni();
    const r = ronde[S.r];
    return {
      status: S.status,
      judulAcara: C.judulAcara,
      ronde: { id: r.id, judul: r.judul, nomor: S.r + 1, jumlah: ronde.length },
      soal: {
        nomor: S.s + 1, total: r.soal.length, teks: so.teks, pilihan: so.pilihan,
        tingkat: so.tingkat || '', durasi: durasiSoal(),
        kunci: S.status === 'HASIL' ? so.kunci : null,
      },
      sisa: sisaDetik(),
      penjawab: Object.keys(S.jawaban).length,
      pemain: Object.keys(S.pengguna).length,
      klasemen: S.klasemen,
      hasil: S.status === 'HASIL' ? S.hasil : null,
      otomatis: S.otomatis,
      // K5: detik sampai aksi otomatis berikutnya (SIAP -> mulai, HASIL/RONDE_SELESAI -> lanjut); null bila manual.
      // Layar menghitung mundur sendiri dari angka ini (tidak ada 'tick' di luar BERJALAN).
      otomatisDalam: otoAkhirMs != null ? Math.max(0, Math.ceil((otoAkhirMs - Date.now()) / 1000)) : null,
      // K5: ronde yang menyusul, hanya saat RONDE_SELESAI (untuk teaser "Berikutnya").
      rondeBerikut: S.status === 'RONDE_SELESAI' && ronde[S.r + 1]
        ? { nomor: S.r + 2, judul: ronde[S.r + 1].judul, jumlahSoal: ronde[S.r + 1].soal.length }
        : null,
      lencanaMin: C.lencanaMin,
      jatah: C.jatahJawaban,
    };
  }

  function infoHost() {
    const per = { A: 0, B: 0, C: 0, D: 0 };
    for (const j of Object.values(S.jawaban)) if (j.huruf) per[j.huruf] += 1;
    const so = soalSaatIni();
    return {
      status: S.status, kunci: so.kunci, teksKunci: so.pilihan['ABCD'.indexOf(so.kunci)],
      per, penjawab: Object.keys(S.jawaban).length, sisa: sisaDetik(),
    };
  }

  function simpanSekarang() {
    if (tundaSimpan) { clearTimeout(tundaSimpan); tundaSimpan = null; }
    if (store) store.simpan(S);
  }
  function jadwalSimpan() {
    if (!store || tundaSimpan) return;
    tundaSimpan = setTimeout(() => { tundaSimpan = null; store.simpan(S); }, 2000);
    if (tundaSimpan.unref) tundaSimpan.unref();
  }
  function jadwalStats() {
    if (tundaStats) return;
    tundaStats = setTimeout(() => {
      tundaStats = null;
      kirim('stats', { penjawab: Object.keys(S.jawaban).length });
    }, 250);
    if (tundaStats.unref) tundaStats.unref();
  }

  function jadwalOtomatis() {
    if (tundaOtomatis) { clearTimeout(tundaOtomatis); tundaOtomatis = null; }
    otoAkhirMs = null;
    if (!S.otomatis) return;
    // K5: awal ronde (soal pertama) boleh lebih lama lewat jedaSiapRonde supaya judul ronde sempat terbaca;
    // tanpa pengaturan itu, perilakunya sama seperti sebelumnya.
    const jedaSiap = S.s === 0 && C.jedaSiapRonde != null ? C.jedaSiapRonde : C.jedaSiap;
    const aksi = { SIAP: [jedaSiap, mulai], HASIL: [C.jedaHasil, lanjut], RONDE_SELESAI: [C.jedaRonde, lanjut] }[S.status];
    if (!aksi) return;
    otoAkhirMs = Date.now() + aksi[0] * 1000;
    tundaOtomatis = setTimeout(() => { tundaOtomatis = null; otoAkhirMs = null; aksi[1](); }, aksi[0] * 1000);
  }

  function perubahan() {
    hitungKlasemen();
    jadwalOtomatis(); // K5: sebelum siaran, supaya 'otomatisDalam' ikut terkirim
    kirim('state', publik());
    simpanSekarang();
  }

  // ---- Pewaktu ----
  function hentikanPewaktu() { if (pewaktu) { clearInterval(pewaktu); pewaktu = null; } }
  function mulaiPewaktu() {
    hentikanPewaktu();
    sisaTerakhir = -1;
    pewaktu = setInterval(() => {
      if (Date.now() >= S.akhirMs) { kunci(); return; }
      const s = sisaDetik();
      if (s !== sisaTerakhir) { sisaTerakhir = s; kirim('tick', { sisa: s }); }
    }, 200);
  }

  // ---- Komentar masuk ----
  // K2: layar menampilkan siapa yang baru menjawab, tanpa membocorkan hurufnya. Maks. 4 per detik;
  // sisanya tetap terhitung di 'stats' sehingga layar tidak banjir saat komentar ramai.
  let jawabTerakhirMs = 0;
  function umumkanJawab(p) {
    const sekarang = Date.now();
    if (sekarang - jawabTerakhirMs < 250) return;
    jawabTerakhirMs = sekarang;
    kirim('jawab', { nama: p.nama, avatar: p.avatar || null });
  }

  function saatKomentar(k) {
    if (S.status !== 'BERJALAN') return;
    if (k.waktuTerima > S.akhirMs) return;
    const h = cocokkan(k.teks, soalSaatIni(), opsiCocok);
    if (h.status !== 'jawaban') return;
    const j = S.jawaban[k.userId] || { n: 0, huruf: null, waktuMs: 0 };
    if (j.n >= C.jatahJawaban) return;
    j.n += 1;
    j.huruf = h.huruf;
    j.waktuMs = Math.max(0, k.waktuTerima - S.mulaiMs); // jawaban terakhir yang dinilai
    S.jawaban[k.userId] = j;
    const p = S.pengguna[k.userId] || { nama: k.nama, avatar: k.avatar || null, total: 0, waktuBenar: 0, streak: 0, ronde: {} };
    p.nama = k.nama || p.nama;
    if (k.avatar) p.avatar = k.avatar;
    S.pengguna[k.userId] = p;
    if (j.n === 1) umumkanJawab(p); // hanya jawaban pertama per soal; mengganti jawaban tidak diumumkan
    jadwalStats();
    jadwalSimpan();
  }
  bus.on('komentar', saatKomentar);

  // ---- Perintah host ----
  function mulai() {
    if (S.status !== 'SIAP') return false;
    S.status = 'BERJALAN';
    S.mulaiMs = Date.now();
    S.akhirMs = S.mulaiMs + durasiSoal() * 1000;
    S.jawaban = {};
    S.hasil = null;
    mulaiPewaktu();
    perubahan();
    return true;
  }

  function kunci() {
    if (S.status !== 'BERJALAN') return false;
    hentikanPewaktu();
    const so = soalSaatIni();
    const rid = ronde[S.r].id;
    const durasi = durasiSoal();
    const benar = [];
    // K2: rekam peringkat sebelum soal ini dinilai, supaya klasemen tahu siapa naik/turun.
    const lalu = urutKlasemen(Object.entries(S.pengguna).filter(([, p]) => p.total > 0)
      .map(([id, p]) => ({ id, nama: p.nama, poin: p.total, waktu: p.waktuBenar })));
    for (const p of Object.values(S.pengguna)) p.peringkatLalu = null;
    lalu.forEach((p, i) => { S.pengguna[p.id].peringkatLalu = i + 1; });
    for (const [id, p] of Object.entries(S.pengguna)) {
      const j = S.jawaban[id];
      if (j && j.huruf === so.kunci) {
        const waktuDtk = Math.min(durasi, j.waktuMs / 1000);
        const { poin } = hitungPoin({ waktuDtk, durasi, runtutanSebelum: p.streak }, C);
        p.streak += 1;
        p.total += poin;
        p.waktuBenar += waktuDtk;
        const pr = p.ronde[rid] || { poin: 0, waktuBenar: 0 };
        pr.poin += poin; pr.waktuBenar += waktuDtk;
        p.ronde[rid] = pr;
        benar.push({ id, nama: p.nama, avatar: p.avatar, waktu: Math.round(waktuDtk * 10) / 10, poin, streak: p.streak, waktuAsli: waktuDtk });
      } else {
        p.streak = 0; // salah atau tidak menjawab
      }
    }
    benar.sort((a, b) => a.waktuAsli - b.waktuAsli);
    const potong = ({ nama, avatar, waktu, poin, streak }) => ({ nama, avatar, waktu, poin, streak });
    const jumlahJawab = Object.keys(S.jawaban).length;
    const hitungHuruf = so.pilihan.map(() => 0);
    for (const j of Object.values(S.jawaban)) if (j.huruf) hitungHuruf['ABCD'.indexOf(j.huruf)] += 1;
    S.hasil = {
      sebaran: hitungHuruf.map((n, i) => ({ huruf: 'ABCD'[i], n, persen: jumlahJawab ? Math.round((n / jumlahJawab) * 100) : 0 })),
      persenBenar: jumlahJawab ? Math.round((benar.length / jumlahJawab) * 100) : 0,
      kunci: so.kunci,
      teksKunci: so.pilihan['ABCD'.indexOf(so.kunci)],
      penjawab: Object.keys(S.jawaban).length,
      totalBenar: benar.length,
      tercepat: benar.slice(0, 3).map(potong),
      juga: { jumlah: Math.max(0, benar.length - 3), avatar: benar.slice(3, 9).map(({ nama, avatar }) => ({ nama, avatar })) },
    };
    S.status = 'HASIL';
    perubahan();
    return true;
  }

  function siapkanSoal() {
    S.status = 'SIAP';
    S.jawaban = {};
    S.hasil = null;
    S.mulaiMs = null;
    S.akhirMs = null;
  }

  function majuBerikut() {
    const soalLagi = S.s + 1 < ronde[S.r].soal.length;
    const rondeLagi = S.r + 1 < ronde.length;
    if (soalLagi) { S.s += 1; siapkanSoal(); }
    else if (rondeLagi) { S.status = 'RONDE_SELESAI'; S.jawaban = {}; S.hasil = null; }
    else { S.status = 'SESI_SELESAI'; S.jawaban = {}; S.hasil = null; }
  }

  function lanjut() {
    if (S.status === 'HASIL') { majuBerikut(); perubahan(); return true; }
    if (S.status === 'RONDE_SELESAI') { S.r += 1; S.s = 0; siapkanSoal(); perubahan(); return true; }
    return false;
  }

  function lewati() {
    if (S.status !== 'SIAP' && S.status !== 'BERJALAN') return false;
    hentikanPewaktu();
    majuBerikut(); // tanpa penilaian, runtutan tidak diubah
    perubahan();
    return true;
  }

  function reset() {
    hentikanPewaktu();
    const otomatis = S.otomatis;
    S = barui();
    S.otomatis = otomatis;
    perubahan();
    return true;
  }

  function aturOtomatis(aktif) {
    S.otomatis = !!aktif;
    perubahan();
    return S.otomatis;
  }

  // Pulihkan pewaktu setelah muat state
  if (S.status === 'BERJALAN') {
    if (Date.now() >= S.akhirMs) kunci(); else mulaiPewaktu();
  }
  hitungKlasemen();
  jadwalOtomatis();

  return {
    mulai, kunci, lewati, lanjut, reset, aturOtomatis,
    publik, infoHost, soalSaatIni, ambilState: () => S,
    status: () => S.status,
    berhenti() {
      hentikanPewaktu();
      for (const t of [tundaStats, tundaSimpan, tundaOtomatis]) if (t) clearTimeout(t);
      bus.off('komentar', saatKomentar);
    },
  };
}
