# cagd-utilities — agent giriş noktası

## Ortak prompt deposu (Makro Gateway Programı)

Bu depo programın **lib izidir**. Prompt'lar, kararlar, sözleşmeler ve **tüm izlerin ilerlemesi** workspace kökündeki ortak depodadır: `../prompts/` (KARARLAR G19).

Göreve başlamadan önce oku:
1. `../prompts/00-PLAN.md` §0 — durum panosu: diğer izler ne yaptı, neyi bekliyor, şu an ne başlatılabilir.
2. `../prompts/lib/00-ORTAK-BAGLAM.md` — bu izin çalışma kuralları ve görev listesi.
3. `../prompts/lib/ILERLEME.md` — bu izin ilerlemesi ve notları.
4. `../prompts/KARARLAR.md` ve `../prompts/SOZLESMELER.md` — bağlayıcı; çelişkide bunlar kazanır.

Kurallar:
- Görev numarası verilmediyse panodaki "Şimdi başlanabilir" sütunundaki görevi öner ve onay iste.
- İlerlemeyi yalnızca `../prompts/lib/ILERLEME.md`'ye ve panoda **bu izin satırına** yaz. Diğer izlerin dosyaları, `KARARLAR.md` ve `SOZLESMELER.md` yalnızca okunur;
  değişiklik önerisi kendi `ILERLEME.md` → Notlar'a yazılır.
- Prompt dosyalarını bu depoya kopyalama veya commit'leme.
