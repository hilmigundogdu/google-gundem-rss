# Google gündem RSS

Google'ın ülke ülke iki listesini RSS 2.0 beslemelerine çevirir; [x-gundem-rss](https://github.com/hilmigundogdu/x-gundem-rss)'in Google karşılığıdır, aynı 28 ülke (Dünya yok: Google'ın dünya listesi yok).

| Besleme | Adres |
|---|---|
| Manşetler | `https://hilmigundogdu.github.io/google-gundem-rss/manset-<ülke>.xml` |
| Aramalar | `https://hilmigundogdu.github.io/google-gundem-rss/arama-<ülke>.xml` |

Ülkeler: `abd`, `turkiye`, `birlesik-krallik`, `almanya`, `fransa`, `ispanya`, `italya`, `hollanda`, `japonya`, `guney-kore`, `hindistan`, `rusya`, `kanada`, `meksika`, `brezilya`, `arjantin`, `suudi-arabistan`, `bae`, `israil`, `misir`, `nijerya`, `kenya`, `guney-afrika`, `pakistan`, `endonezya`, `filipinler`, `singapur`, `avustralya`. Liste [yayımlanmış sayfada](https://hilmigundogdu.github.io/google-gundem-rss/) da var.

## Öğeler

- **Manşet:** Google News'in o ülkedeki "Öne çıkanlar" listesinin ilk 20 olayı, Google'ın sırasıyla. Başlık bayrak ve özgün başlıktır, bağlantı haberin kendisidir. Gövde:
  - dili İngilizce ya da Türkçe değilse başlığın İngilizce ve Türkçe çevirisi,
  - ayırıcının altında aynı olayı yazan öteki kaynaklar (Google'ın kümesi),
  - en sonda ülke, kaynak, saat ve dil.
- **Arama:** Google Trends'in o ülkede o an trend olan 10 araması. Başlık bayrak ve aranan sözdür, bağlantı Google aramasıdır. `guid` ülke, söz ve İstanbul günüdür: aynı söz ertesi gün yeniden trend olursa yeni öğedir. Gövde:
  - dili İngilizce ya da Türkçe değilse aranan sözün ve haber başlıklarının İngilizce ve Türkçe çevirisi (çeviriler habere bağlı),
  - ayırıcının altında özgün dilde **Ülkedeki haberler** (en çok 3) ve **Google Trends'in haberleri** (görseliyle),
  - en sonda tahmini arama hacmi (`1000+`), başlangıç saati, dil, Google ve Trends bağlantıları.

  Trends'in haberleri aranan söze dünya genelinde uyan haberlerdir; genel bir sözde başka ülkeden gelir (BAE'de "public holiday" → ABD'de bir ışık festivali). Bu yüzden söz ayrıca o ülkenin Google News'inde son 24 saatte aranır. Yalnız Latin harfli söz Arapça, İbranice, Japonca, Korece ya da Rusça haberlerde bulunmadığından o ülkelerde İngilizce haberlerde ülke adıyla aranır (`"public holiday" UAE`). Google eşleştirmeyi gevşek yaptığı için başlıkta sözün en uzun sözcüğü geçmeyen haber atılır; Trends'in de verdiği haber tekrarlanmaz.

## Nasıl çalışır

- GitHub Actions `google.mjs`'i çalıştırır, çıktıyı GitHub Pages'te yayımlar; depoya commit atılmaz. Asıl tetikleyici Mac mini'deki launchd işidir (`local.gundem-tetik`, 30 dakikada bir); depodaki cron yedektir.
- **Manşetler** `news.google.com/rss?hl=…&gl=…&ceid=…`, **aramalar** `trends.google.com/trending/rss?geo=<ülke kodu>` adresinden gelir; kimlik gerekmez. İstekler arasında 1 sn. Bir liste alınamazsa önceki beslemesi Pages'ten aynen taşınır; Google News Actions IP'lerine zaman zaman 503 veriyor, o çalışmada manşetler eski kalır.
- **Çeviri** Google Translate'in anahtarsız ucundan (`translate_a/t?client=gtx`) 40'arlı istekle gelir: önce İngilizceye; dili İngilizce ya da Türkçe olan, ya da çevirisi aynı kalan (özel ad) metin çevrilmez, kalanlar Türkçeye de çevrilir. Google Trends aramaları küçük harfle verdiği için aranan söz çeviriye baş harfleri büyük gider ("apple störungen" → "Apple aksaklıkları").
- **Ülke haberleri** her arama için bir kez aranır, 12 saat eskiyince yeniden; önce hiç aranmamışlar, ülkeler sırayla, her ülkede en çok arananlar önce. Google News Actions'tan 40-150 istekte 429 veriyor; ilk doluş birkaç çalışma sürer. Çalışma başına en çok 100 istek; Google News 429 ya da 503 verirse kalanı sonraki çalışmaya kalır.
- **Durum** `state.json` olarak yayımlanır, çevirileri ve ülke haberlerini taşır: her metin bir kez çevrilir, beslemeden çıkan metnin çevirisi silinir (bir liste alınamadıysa silinmez); trendden düşen aramanın haberleri silinir, hiçbir sonuç iki günden uzun tutulmaz. Yalnız 404 sıfırdan başlatır; başka hatada yayın yapılmaz.
- Yerel deneme: `node google.mjs --out /tmp/g --countries almanya,japonya` (`--prev state.json` ile önceki çeviriler).
