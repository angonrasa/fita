# Kuis Kelas 5 SD
Kuis pilihan ganda A–D, jawab dengan mengetuk. Murni HTML/JS statis (tanpa server).

Jalankan lokal: `python3 -m http.server` lalu buka http://localhost:8000 (jangan lewat file://, karena memakai ES module & fetch).
GitHub Pages: push isi folder ini ke repo → Settings → Pages → Deploy from branch (main, / root).
Ubah/tambah soal: `data/soal.json` (ronde → soal; `kunci` = A/B/C/D). Setelan: objek `CFG` di `live-lokal.js`.
Skor tersimpan di localStorage browser; mulai dari nol lewat tombol "Main lagi" di akhir kuis.
