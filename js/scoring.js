// scoring.js — rumus poin, runtutan, dan urutan klasemen. Murni, tanpa I/O.
// Semua angka datang dari config.json; nilai bawaan di bawah hanya cadangan.

const BAWAAN = { poinDasar: 100, faktorMin: 0.5, pengaliLangkah: 0.25, pengaliMaks: 2.5 };

// Faktor waktu turun linear dari 1,0 (langsung) ke faktorMin (detik terakhir).
export function faktorWaktu(waktuDtk, durasi, faktorMin = BAWAAN.faktorMin) {
  const rasio = durasi > 0 ? Math.min(1, Math.max(0, waktuDtk / durasi)) : 1;
  return 1 - (1 - faktorMin) * rasio;
}

// Pengali dari runtutan benar sebelum soal ini: 0 -> 1x, 1 -> 1,25x, 2 -> 1,5x ... maksimum pengaliMaks.
export function pengaliRuntutan(runtutanSebelum, langkah = BAWAAN.pengaliLangkah, maks = BAWAAN.pengaliMaks) {
  return Math.min(maks, 1 + langkah * Math.max(0, runtutanSebelum));
}

export function hitungPoin({ waktuDtk, durasi, runtutanSebelum }, cfg = {}) {
  const c = { ...BAWAAN, ...cfg };
  const pengali = pengaliRuntutan(runtutanSebelum, c.pengaliLangkah, c.pengaliMaks);
  const poin = Math.round(c.poinDasar * faktorWaktu(waktuDtk, durasi, c.faktorMin) * pengali);
  return { poin, pengali };
}

// Urut: poin terbesar, seri dipecah total waktu menjawab benar yang lebih kecil, lalu nama.
export function urutKlasemen(daftar) {
  return [...daftar].sort((a, b) =>
    (b.poin - a.poin) || (a.waktu - b.waktu) || String(a.nama).localeCompare(String(b.nama)));
}
