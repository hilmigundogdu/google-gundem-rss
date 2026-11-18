#!/usr/bin/env node
// Google'ın ülke ülke iki listesini RSS 2.0 beslemelerine çevirir (Node 22):
//   manşetler: Google News'in "Öne çıkanlar" listesi; her öğe bir olay ve onu yazan kaynaklar (Google'ın kümesi),
//   aramalar:  Google Trends'in o an trend olan aramaları; tahmini arama hacmi ve ilgili haberlerle.
// Başlık özgün kalır; dili İngilizce ya da Türkçe olmayan öğenin gövdesi İngilizce ve Türkçe çeviriyle başlar (Google Translate'in
// anahtarsız ucu). Kimlik gerekmez.
//
// Ortam:  BASE_URL  yayımlanmış sitenin adresi; önceki durum (çeviriler) BASE_URL/state.json'dan okunur.
//         OUT_DIR   çıktı klasörü (varsayılan: public).
// Yerel deneme:  node google.mjs [--prev eski/state.json] [--out klasor] [--countries almanya,japonya]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const REPO = 'https://github.com/hilmigundogdu/google-gundem-rss';
const USER_AGENT = `google-gundem-rss/1.0 (+${REPO})`;
const NEWS = 'https://news.google.com/rss';
const TRENDS = 'https://trends.google.com/trending/rss';
const TRANSLATE = 'https://translate.googleapis.com/translate_a/t';
const HEADLINES = 20;                         // ülke başına beslemeye giren manşet (Google'ın sırasıyla)
const GAP_MS = 1_000;                         // Google News ve Trends istekleri arasındaki en kısa ara
const TRANSLATE_BATCH = 40, TRANSLATE_CHARS = 4_000; // bir çeviri isteğindeki en çok metin ve karakter
const TRANSLATE_GAP_MS = 1_000;
const FETCH_TIMEOUT_MS = 30_000;

// news: Google News'in dil ve ülke parametreleri (gl Trends'in ülke kodu ve bayrak olur); lang: içerik İngilizce ya da Türkçeyse
// çeviri denenmez, null (çok dilli) ya da başka dilse metin metin dil tespitiyle çevrilir. X Gündem'in bölgeleriyle aynı; Dünya yok
// (Google'ın dünya listesi yok).
const COUNTRIES = [
  { slug: 'abd', name: 'ABD', lang: 'en', news: 'hl=en-US&gl=US&ceid=US:en' },
  { slug: 'turkiye', name: 'Türkiye', lang: 'tr', news: 'hl=tr&gl=TR&ceid=TR:tr' },
  { slug: 'birlesik-krallik', name: 'Birleşik Krallık', lang: 'en', news: 'hl=en-GB&gl=GB&ceid=GB:en' },
  { slug: 'almanya', name: 'Almanya', lang: 'de', news: 'hl=de&gl=DE&ceid=DE:de' },
  { slug: 'fransa', name: 'Fransa', lang: 'fr', news: 'hl=fr&gl=FR&ceid=FR:fr' },
  { slug: 'ispanya', name: 'İspanya', lang: 'es', news: 'hl=es&gl=ES&ceid=ES:es' },
  { slug: 'italya', name: 'İtalya', lang: 'it', news: 'hl=it&gl=IT&ceid=IT:it' },
  { slug: 'hollanda', name: 'Hollanda', lang: 'nl', news: 'hl=nl&gl=NL&ceid=NL:nl' },
  { slug: 'japonya', name: 'Japonya', lang: 'ja', news: 'hl=ja&gl=JP&ceid=JP:ja' },
  { slug: 'guney-kore', name: 'Güney Kore', lang: 'ko', news: 'hl=ko&gl=KR&ceid=KR:ko' },
  { slug: 'hindistan', name: 'Hindistan', lang: null, news: 'hl=en-IN&gl=IN&ceid=IN:en' },
  { slug: 'rusya', name: 'Rusya', lang: 'ru', news: 'hl=ru&gl=RU&ceid=RU:ru' },
  { slug: 'kanada', name: 'Kanada', lang: 'en', news: 'hl=en-CA&gl=CA&ceid=CA:en' },
  { slug: 'meksika', name: 'Meksika', lang: 'es', news: 'hl=es-419&gl=MX&ceid=MX:es-419' },
  { slug: 'brezilya', name: 'Brezilya', lang: 'pt', news: 'hl=pt-BR&gl=BR&ceid=BR:pt-419' },
  { slug: 'arjantin', name: 'Arjantin', lang: 'es', news: 'hl=es-419&gl=AR&ceid=AR:es-419' },
  { slug: 'suudi-arabistan', name: 'Suudi Arabistan', lang: 'ar', news: 'hl=ar&gl=SA&ceid=SA:ar' },
  { slug: 'bae', name: 'BAE', lang: null, news: 'hl=ar&gl=AE&ceid=AE:ar' },
  { slug: 'israil', name: 'İsrail', lang: 'he', news: 'hl=he&gl=IL&ceid=IL:he' },
  { slug: 'misir', name: 'Mısır', lang: 'ar', news: 'hl=ar&gl=EG&ceid=EG:ar' },
  { slug: 'nijerya', name: 'Nijerya', lang: 'en', news: 'hl=en-NG&gl=NG&ceid=NG:en' },
  { slug: 'kenya', name: 'Kenya', lang: 'en', news: 'hl=en-KE&gl=KE&ceid=KE:en' },
  { slug: 'guney-afrika', name: 'Güney Afrika', lang: 'en', news: 'hl=en-ZA&gl=ZA&ceid=ZA:en' },
  { slug: 'pakistan', name: 'Pakistan', lang: null, news: 'hl=en-PK&gl=PK&ceid=PK:en' },
  { slug: 'endonezya', name: 'Endonezya', lang: 'id', news: 'hl=id&gl=ID&ceid=ID:id' },
  { slug: 'filipinler', name: 'Filipinler', lang: null, news: 'hl=en-PH&gl=PH&ceid=PH:en' },
  { slug: 'singapur', name: 'Singapur', lang: null, news: 'hl=en-SG&gl=SG&ceid=SG:en' },
  { slug: 'avustralya', name: 'Avustralya', lang: 'en', news: 'hl=en-AU&gl=AU&ceid=AU:en' },
].map(c => ({ ...c, gl: /gl=([A-Z]{2})/.exec(c.news)[1] }));

const { values: args } = parseArgs({ options: { prev: { type: 'string' }, out: { type: 'string' }, countries: { type: 'string' } } });
const baseUrl = (process.env.BASE_URL || '').replace(/\/?$/, '/');
const outDir = args.out || process.env.OUT_DIR || 'public';
const countries = args.countries ? COUNTRIES.filter(c => args.countries.split(',').includes(c.slug)) : COUNTRIES;
if (!countries.length) { console.error('HATA: --countries geçersiz.'); process.exit(2); }

// ---- Yardımcılar

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => e[0] !== '#' ? ENTITIES[e.toLowerCase()] ?? all
  : String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const esc = s => String(s).replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cdata = s => `<![CDATA[${String(s).replace(INVALID_XML, '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const keyOf = s => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const flag = gl => String.fromCodePoint(...gl.split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
const number = n => new Intl.NumberFormat('tr-TR').format(n);
const sameText = (a, b) => keyOf(a) === keyOf(b);
// Google Trends aramaları küçük harfle verir; çeviri özel adı tanısın diye sözcüklerin baş harfi büyütülür
// ("apple störungen" → "Apple aksaklıkları", küçük harfle "elma aksaklıkları").
const asked = query => query.replace(/(^|[\s-])(\p{Ll})/gu, (m, gap, c) => gap + c.toLocaleUpperCase());
const LANG_NAMES = new Intl.DisplayNames(['tr'], { type: 'language' });
const langName = code => { try { return LANG_NAMES.of(code); } catch { return code; } };

function time(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms).map(x => [x.type, x.value]));
  return `${p.day}.${p.month} ${p.hour}:${p.minute}`;
}
// İstanbul saatine göre gün: aynı arama ertesi gün yeniden trend olursa yeni öğe olur.
const dayOf = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(ms);

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  return { status: res.status, ok: res.ok, body: await res.text() };
}

const field = (xml, tag) => decode(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? '').trim();
const items = xml => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);

// ---- Durum: önceki çalışmanın state.json'u; translations[özgün metin] = { lang, en, tr } (çeviri gerekmiyorsa en ve tr null).

async function loadState() {
  const empty = { version: 1, translations: {} };
  let raw;
  if (args.prev) raw = JSON.parse(await readFile(args.prev, 'utf8'));
  else if (!process.env.BASE_URL) return empty;
  else {
    const res = await get(`${baseUrl}state.json?t=${Date.now()}`);
    if (res.status === 404) { console.log('Önceki durum yok; çeviriler sıfırdan.'); return empty; }
    if (!res.ok) throw new Error(`Önceki durum okunamadı (HTTP ${res.status}); yayın yapılmadı.`);
    raw = JSON.parse(res.body);
  }
  return { ...empty, ...raw };
}

// ---- Google News manşetleri: başlık "Başlık - Kaynak"; açıklama olayın kümesi (<ol><li><a>başlık</a> <font>kaynak</font></li>…).

async function fetchHeadlines(country) {
  const res = await get(`${NEWS}?${country.news}`);
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  return items(res.body).slice(0, HEADLINES).map(item => {
    const source = field(item, 'source');
    let title = field(item, 'title');
    // Yayıncı adı bazen iki kez eklenir ("… - Wirtschaft - SZ.de - SZ.de").
    while (source && title.endsWith(` - ${source}`) && title.length > source.length + 3) title = title.slice(0, -source.length - 3).trim();
    const cluster = [...field(item, 'description').matchAll(/<li><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:\s|&nbsp;)*(?:<font[^>]*>([\s\S]*?)<\/font>)?/g)]
      .map(([, url, t, s]) => ({ url: decode(url), title: decode(t).trim(), source: decode(s ?? '').trim() }));
    return { id: field(item, 'guid'), title, source, url: field(item, 'link'), at: Date.parse(field(item, 'pubDate')) || null, cluster };
  }).filter(h => h.id && h.title);
}

// ---- Google Trends aramaları: <ht:approx_traffic>, <ht:picture>, <ht:news_item> (başlık, adres, kaynak, görsel).

async function fetchSearches(country) {
  const res = await get(`${TRENDS}?geo=${country.gl}`);
  if (!res.ok) throw new Error(`Google Trends HTTP ${res.status}`);
  return items(res.body).map(item => ({
    query: field(item, 'title'), traffic: field(item, 'ht:approx_traffic'), at: Date.parse(field(item, 'pubDate')) || null,
    picture: field(item, 'ht:picture'), pictureSource: field(item, 'ht:picture_source'),
    news: [...item.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].map(([, n]) => ({
      title: field(n, 'ht:news_item_title'), url: field(n, 'ht:news_item_url'), source: field(n, 'ht:news_item_source'),
    })).filter(n => n.title && n.url),
  })).filter(s => s.query);
}

// ---- Çeviri: Google Translate'in anahtarsız ucu birden çok metni bir istekte çevirir, her metnin dilini ayrı tespit eder
// ([[çeviri, dil], …]). Önce İngilizceye: dil İngilizce ya da Türkçeyse, belirlenemediyse ya da çeviri özgünün aynısıysa (özel ad)
// çeviri gerekmez; kalanlar Türkçeye de çevrilir.

// source verilirse yanıt yalnız metinlerdir; dil olarak source döner.
async function translate(texts, target, source = 'auto') {
  const body = new URLSearchParams(texts.map(q => ['q', q]));
  const res = await fetch(`${TRANSLATE}?client=gtx&sl=${source}&tl=${target}`, {
    method: 'POST', body, headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
  const data = await res.json();
  const list = texts.length === 1 && typeof data?.[0] === 'string' ? [data] : data;
  if (!Array.isArray(list) || list.length !== texts.length) throw new Error('Google Translate yanıtı beklenen biçimde değil.');
  return list.map(item => (typeof item === 'string' ? [item, source] : item))
    .map(([text, lang]) => ({ text: String(text ?? ''), lang: String(lang ?? (source === 'auto' ? '' : source)) }));
}

const LATIN = /\p{Script=Latin}/u;
const UNTRANSLATED = ['en', 'tr', 'auto', 'und', ''];

// hints: metin → ülkenin dili. Latin harfi olmayan kısa metni Google bazen İngilizce sanıp çevirmiyor (西野亮廣 → "en");
// böyle metinler ülkenin diliyle ayrıca çevrilir.
async function translateAll(texts, cache, hints) {
  const chunks = [];
  for (const text of texts) {
    const last = chunks.at(-1);
    if (last && last.length < TRANSLATE_BATCH && last.reduce((n, t) => n + t.length, text.length) <= TRANSLATE_CHARS) last.push(text);
    else chunks.push([text]);
  }
  let requests = 0;
  for (const chunk of chunks) {
    if (requests) await sleep(TRANSLATE_GAP_MS);
    const en = await translate(chunk, 'en'); requests++;
    const tr = new Map();
    const missed = chunk.filter((text, i) => UNTRANSLATED.includes(en[i].lang) && !LATIN.test(text) && hints.get(text) && !UNTRANSLATED.includes(hints.get(text)));
    for (const lang of new Set(missed.map(text => hints.get(text)))) {
      const group = missed.filter(text => hints.get(text) === lang);
      await sleep(TRANSLATE_GAP_MS);
      const [enAgain, trAgain] = [await translate(group, 'en', lang), await translate(group, 'tr', lang)]; requests += 2;
      group.forEach((text, k) => { en[chunk.indexOf(text)] = enAgain[k]; tr.set(text, trAgain[k].text); });
    }
    const foreign = chunk.filter((text, i) => !UNTRANSLATED.includes(en[i].lang) && !sameText(en[i].text, text));
    const rest = foreign.filter(text => !tr.has(text));
    if (rest.length) {
      await sleep(TRANSLATE_GAP_MS);
      (await translate(rest, 'tr')).forEach((t, k) => tr.set(rest[k], t.text)); requests++;
    }
    chunk.forEach((text, i) => {
      const trText = tr.get(text);
      cache[text] = !foreign.includes(text) ? { lang: en[i].lang, en: null, tr: null }
        : { lang: en[i].lang, en: en[i].text, tr: trText && !sameText(trText, text) ? trText : null };
    });
  }
  return requests;
}

// ---- RSS

const link = (url, text) => `<a href="${esc(url)}">${esc(text)}</a>`;
// Çeviri satırı: <b>EN</b> … <br><b>TR</b> …; bağlantı verilirse çeviriler de o adrese gider.
const translated = (t, url) => [t.en && `<b>EN</b> ${url ? link(url, t.en) : esc(t.en)}`, t.tr && `<b>TR</b> ${url ? link(url, t.tr) : esc(t.tr)}`]
  .filter(Boolean).join('<br>');
const has = t => Boolean(t?.en || t?.tr);

function headlineItem(country, h, translations) {
  const t = translations[h.title], lines = [];
  const others = h.cluster.filter(c => !sameText(c.title, h.title));
  if (has(t)) lines.push(`<p>${translated(t)}</p>`, ...(others.length ? ['<hr>'] : []));
  if (others.length) lines.push('<p><b>Aynı olayı yazanlar</b></p>',
    `<ul>\n${others.map(c => `<li>${link(c.url, c.title)}${c.source ? ` — ${esc(c.source)}` : ''}</li>`).join('\n')}\n</ul>`);
  lines.push(`<p><small>${flag(country.gl)} ${esc(country.name)} · Google News manşeti · ${esc(h.source || 'kaynak')}${h.at ? ` · ${time(h.at)}` : ''}`
    + `${has(t) ? ` · ${esc(langName(t.lang))}` : ''} · ${link(h.url, 'Haberi aç')}</small></p>`);
  return {
    title: `${flag(country.gl)} ${h.title}`, link: h.url, guid: `google-manset:${country.slug}:${h.id}`, date: h.at ?? Date.now(),
    author: h.source, categories: [country.name, 'Google News'], description: lines.join('\n'),
  };
}

function searchItem(country, s, translations) {
  const google = `https://www.google.com/search?q=${encodeURIComponent(s.query)}&gl=${country.gl}`;
  const trends = `https://trends.google.com/trends/explore?q=${encodeURIComponent(s.query)}&geo=${country.gl}&date=now%201-d`;
  const t = translations[asked(s.query)], lines = [];
  // Gövde çeviriyle başlar: önce aranan söz, sonra haber başlıkları (kaynağıyla, habere bağlı).
  const rows = s.news.map(n => ({ n, t: translations[n.title] })).filter(r => has(r.t));
  if (has(t)) lines.push(`<p>${translated(t)}</p>`);
  if (rows.length) lines.push(`<ul>\n${rows.map(r => `<li>${translated(r.t, r.n.url)}${r.n.source ? ` — ${esc(r.n.source)}` : ''}</li>`).join('\n')}\n</ul>`);
  if ((has(t) || rows.length) && (s.picture || s.news.length)) lines.push('<hr>');
  if (s.picture) lines.push(`<p><img src="${esc(s.picture)}" alt="${esc(s.pictureSource)}"></p>`);
  if (s.news.length) lines.push(`<ul>\n${s.news.map(n => `<li>${link(n.url, n.title)}${n.source ? ` — ${esc(n.source)}` : ''}</li>`).join('\n')}\n</ul>`);
  const lang = has(t) ? t.lang : rows[0]?.t.lang;
  lines.push(`<p><small>${flag(country.gl)} ${esc(country.name)} · Google'da ${esc(s.traffic || '?')} arama${s.at ? ` · başlangıç ${time(s.at)}` : ''}`
    + `${lang ? ` · ${esc(langName(lang))}` : ''} · ${link(google, "Google'da ara")} · ${link(trends, 'Trends')}</small></p>`);
  return {
    title: `${flag(country.gl)} ${s.query}`, link: google, guid: `google-arama:${country.slug}:${keyOf(s.query)}:${dayOf(s.at ?? Date.now())}`,
    date: s.at ?? Date.now(), categories: [country.name, 'Google Trends'], description: lines.join('\n'),
  };
}

function render(channel, list, now) {
  const date = ms => new Date(ms).toUTCString();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${esc(channel.title)}</title>`,
    `<link>${esc(channel.link)}</link>`,
    `<description>${esc(channel.description)}</description>`,
    '<language>tr</language>',
    `<lastBuildDate>${date(now)}</lastBuildDate>`,
    '<ttl>30</ttl>',
    `<generator>${REPO}</generator>`,
    ...(process.env.BASE_URL ? [`<atom:link href="${esc(baseUrl + channel.file)}" rel="self" type="application/rss+xml"/>`] : []),
  ];
  for (const item of list) {
    lines.push('<item>',
      `<title>${esc(item.title)}</title>`,
      `<link>${esc(item.link)}</link>`,
      `<guid isPermaLink="false">${esc(item.guid)}</guid>`,
      `<pubDate>${date(item.date)}</pubDate>`,
      ...(item.author ? [`<author>${esc(item.author)}</author>`] : []),
      ...item.categories.map(c => `<category>${esc(c)}</category>`),
      `<description>${cdata(item.description)}</description>`,
      '</item>');
  }
  lines.push('</channel>', '</rss>', '');
  return lines.join('\n');
}

function indexHtml(files, now) {
  const rows = files.map(f => `<li><a href="${esc(f.file)}">${esc(f.title)}</a></li>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Google gündem RSS</title>
<h1>Google gündem RSS</h1><p>Google News manşetleri ve Google Trends aramaları ülke ülke, İngilizce ve Türkçe çeviriyle. Son üretim: ${time(now)} (İstanbul). <a href="${REPO}">Kaynak</a></p>
<ul>
${rows}
</ul>
`;
}

// ---- Ana akış

async function main() {
  const now = Date.now();
  const state = await loadState();

  // 1. Listeler. Alınamayan listenin önceki beslemesi Pages'ten aynen taşınır (Pages her yayında bütünüyle yenilenir); hiçbiri alınamazsa
  // yayın yapılmaz.
  const lists = new Map();
  let failed = 0, first = true;
  for (const country of countries) {
    const entry = {};
    for (const [kind, fetcher] of [['headlines', fetchHeadlines], ['searches', fetchSearches]]) {
      if (!first) await sleep(GAP_MS);
      first = false;
      try { entry[kind] = await fetcher(country); }
      catch (e) { failed++; console.log(`${country.name} ${kind === 'headlines' ? 'manşetleri' : 'aramaları'} alınamadı: ${e.message}`); }
    }
    lists.set(country.slug, entry);
    console.log(`${country.name}: ${entry.headlines?.length ?? '–'} manşet, ${entry.searches?.length ?? '–'} arama.`);
  }
  if (failed === countries.length * 2) throw new Error('Hiçbir liste alınamadı; yayın yapılmadı.');

  // 2. Çeviri: dili İngilizce ya da Türkçe olmayan ülkelerde manşet başlığı, aranan söz ve aramanın haber başlıkları. Saklanan çeviri
  // bir kez çevrilir; bütün listeler alındıysa beslemede kalmayan metnin çevirisi silinir.
  const wanted = new Set(), todo = [], hints = new Map();
  for (const country of countries) {
    if (country.lang === 'en' || country.lang === 'tr') continue;
    const { headlines = [], searches = [] } = lists.get(country.slug);
    for (const text of [...headlines.map(h => h.title), ...searches.flatMap(s => [asked(s.query), ...s.news.map(n => n.title)])]) {
      if (wanted.has(text)) continue;
      wanted.add(text);
      hints.set(text, country.lang);
      const kept = state.translations[text];
      // Eski sürümün İngilizce sanıp çevirmediği Latin dışı metin yeniden çevrilir.
      if (!kept || (UNTRANSLATED.includes(kept.lang) && !LATIN.test(text))) todo.push(text);
    }
  }
  // Bir liste alınamadıysa önceki beslemesi taşınır; çevirileri de sonraki çalışma için kalır.
  if (!failed) for (const text of Object.keys(state.translations)) if (!wanted.has(text)) delete state.translations[text];
  if (todo.length) {
    let requests = 0;
    try { requests = await translateAll(todo, state.translations, hints); }
    catch (e) { console.log(`Çeviri yarıda kaldı: ${e.message}`); }
    console.log(`Çeviri: ${todo.filter(text => state.translations[text]).length}/${todo.length} metin${requests ? `, ${requests} istek` : ''}.`);
  }

  // 3. Yazma.
  await mkdir(outDir, { recursive: true });
  const files = [];
  const carry = async (file, title) => {
    const res = process.env.BASE_URL ? await get(`${baseUrl}${file}`).catch(() => null) : null;
    if (res?.ok) { await writeFile(join(outDir, file), res.body); files.push({ file, title }); console.log(`${file}: önceki besleme taşındı.`); }
  };
  for (const country of countries) {
    const { headlines, searches } = lists.get(country.slug);
    const name = `${flag(country.gl)} ${country.name}`;
    if (!headlines) await carry(`manset-${country.slug}.xml`, `Google Manşet · ${country.name}`);
    if (!searches) await carry(`arama-${country.slug}.xml`, `Google Arama · ${country.name}`);
    if (headlines) {
      const file = `manset-${country.slug}.xml`, title = `Google Manşet · ${country.name}`;
      await writeFile(join(outDir, file), render({ file, title, link: `https://news.google.com/?${country.news}`,
        description: `${name}: Google News'in öne çıkan haberleri, İngilizce ve Türkçe çeviriyle.` },
        headlines.map(h => headlineItem(country, h, state.translations)), now));
      files.push({ file, title });
    }
    if (searches) {
      const file = `arama-${country.slug}.xml`, title = `Google Arama · ${country.name}`;
      await writeFile(join(outDir, file), render({ file, title, link: `https://trends.google.com/trending?geo=${country.gl}`,
        description: `${name}: Google Trends'te o an trend olan aramalar, İngilizce ve Türkçe çeviriyle.` },
        searches.map(s => searchItem(country, s, state.translations)), now));
      files.push({ file, title });
    }
  }
  await writeFile(join(outDir, 'state.json'), JSON.stringify(state));
  await writeFile(join(outDir, 'index.html'), indexHtml(files, now));
  console.log(`Yazıldı: ${files.length} besleme → ${outDir}`);
}

main().catch(e => { console.error(`HATA: ${e.message}`); process.exit(1); });
