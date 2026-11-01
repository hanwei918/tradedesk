# rules.json sources (fetched 2026-10-26)

All 28 excerpts were checked against the fetched page text after whitespace normalisation: curl/PDF pages by script, JS-rendered pages in a browser with `innerText.includes()`. A deliberately altered excerpt failed the same check, so the check can fail.

## Fetched and used

| URL | How fetched | Status | Rules |
|---|---|---|---|
| https://sellercentral.amazon.com/help/hub/reference/external/GYTR6SYGFA5E3EQC | browser (curl/WebFetch get only a JS shell) | OK | AMZ-01..04 |
| https://sellercentral.amazon.com/help/hub/reference/external/GX5L8BF8GLMML6CX | browser | OK | AMZ-05 |
| https://sellercentral.amazon.com/help/hub/reference/external/G200390640 | browser | OK | AMZ-06, AMZ-07 |
| https://rule.alibaba.com/rule/detail/11000682.htm (redirects to rulechannel.alibaba.com) | browser | OK; page says "Revised on June 5, 2017" | ALI-01, ALI-02 |
| https://rule.alibaba.com/rule/detail/2063.htm (redirects to rulechannel.alibaba.com) | browser | OK; dated 2015-01-04 | ALI-03 |
| https://seller-mx.tiktok.com/university/essay?knowledge_id=8289533054535425&lang=es-419 | browser | OK; "Se aplica a: México", dated 10/08/2026 | TT-01..03 |
| https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-16?part=260&section=260.4 | curl (official eCFR API; the normal ecfr.gov page redirects bots to unblock.federalregister.gov) | OK | US-01 |
| https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-16?part=323 | curl (eCFR API) | OK | US-02 |
| https://www.law.cornell.edu/regulations/california/27-CCR-25602 | curl | OK; **secondary** (Cornell LII copy of the regulation, amendment operative 1/1/2025) | US-03 |
| https://www.law.cornell.edu/regulations/california/27-CCR-25603 | curl | OK; **secondary** | US-04 |
| https://platiica.economia.gob.mx/wp-content/uploads/sites/2/PDF_Normas_Publicas/024scfi2013.pdf | curl + pdftotext | OK (DOF 12 Aug 2013) | MX-01, MX-02 |
| https://platiica.economia.gob.mx/wp-content/uploads/sites/2/PDF_Normas_Publicas/003scfi2015.pdf | curl + pdftotext | OK (DOF 28 May 2015) | MX-03 |
| https://academy.iccwbo.org/incoterms/article/incoterms-2020-fas-or-fob/ | curl | OK; an ICC Academy article, not the rulebook text (ICC Pub. 723E is paid) | INC-01..03 |
| https://academy.iccwbo.org/incoterms/article/incoterms-2020-cfr-or-cif/ | curl | OK; ICC Academy article | INC-04, INC-05 |
| https://gringogazette.com/doing-business-in-mexico-dont-get-lost-in-translation/ | curl | OK; **secondary** | CUL-01, CUL-02 |
| https://cibtvisas.com/blog/business-etiquette-mexico | curl | OK; **secondary** | CUL-03 |

## Fetched but not used

- https://platiica.economia.gob.mx/wp-content/uploads/sites/2/PDF_Normas_Publicas/050scfi.pdf (NOM-050-SCFI-2004): fetched OK. Not used because its clause 2.2 a) excludes products covered by a specific NOM. For an electric kettle that NOM is NOM-024-SCFI-2013, so MX-01 and MX-02 cite NOM-024 instead.
- https://sellercentral.amazon.com/help/hub/reference/external/G201707070 (General Listing Restrictions): fetched OK. Not used because its claims and environmental rows overlap AMZ-05 and US-01.
- https://iccwbo.org/business-solutions/incoterms-rules/incoterms-2020/: fetched OK. It does not contain the sea-only statements.
- https://seller-us.tiktok.com/university/essay?knowledge_id=4581457528194817&lang=en ("How to Avoid Misleading Content"): fetched OK, but it is marked "Applies to: United States". The MX policy page is used instead.
- https://seller.alibaba.com/pages/seller_onboarding_rules.html: fetched OK. It mentions "false or exaggerated publicity" as a violation but was not needed.
- https://www.bizlatinhub.com/guides/mexico/6-tips-business-etiquette-in-mexico/: fetched OK, not used.

## Failed or blocked

- https://www.p65warnings.ca.gov/new-proposition-65-warnings and https://oehha.ca.gov/proposition-65/law/article-6-clear-and-reasonable-warnings: Imperva bot check / CAPTCHA (not bypassed). This is why Prop 65 uses the LII copy.
- https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf (Ley Federal de Protección al Consumidor): connection refused or timed out (curl, WebFetch, browser). https://www.ordenjuridico.gob.mx/... also timed out.
- https://mexiconewsdaily.com/culture/doing-business-in-mexico-dont-get-lost-in-translation/: HTTP 403.
- https://rule.alibaba.com/rule/index.htm: redirected to a Taobao error page.
- https://seller-mx.tiktok.com/university/essay?knowledge_id=4581457528194817&lang=es: 404 (no MX version of the US "misleading content" article).

## Dropped (could not verify from a fetched primary or authoritative page)

- Alibaba.com rule against putting off-platform contact info in buyer replies. No public Alibaba.com rule page with that text was fetched. Only buyer-side blog content and third-party summaries turned up.
- LFPC Art. 32/34 (Spanish-language requirement and misleading advertising in Mexican consumer law): the official text could not be fetched. A copy exists at mley.mx (secondary) but was not used, because NOM-024 already covers the Spanish-language requirement.
- Amazon title limit of 200 characters: many articles still cite it, but the official page fetched today says **75**.

## Added 2026-10-26 (product image rules)

| URL | How fetched | Status | Rules |
|---|---|---|---|
| https://sellercentral.amazon.com/help/hub/reference/external/G1881 ("Product image guide", "This article applies to selling in: United States") | browser (JS-rendered), excerpts checked with `innerText.includes()` | OK | IMG-01..10 |

IMG-04 (85%) and IMG-05 (entire product in frame) are measured by code from the non-white bounding box; that measurement is an estimate and the UI says so.

# Added 2026-10-31: EU, Japan, Eurasian Economic Union, Nigeria

Seven rules for four markets, all `kind: llm` and limited to `alibaba_rfq` replies for their own market, so prompts for the US and Mexico did not change. Each excerpt was found verbatim in the fetched page text after whitespace normalisation (EUR-Lex in a browser with `innerText.indexOf()`, because it answers scripts with an empty 202; the others by curl, the EEC PDF through pdftotext).

| URL | How fetched | Status | Rules |
|---|---|---|---|
| https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32014L0035 | browser | OK; Directive 2014/35/EU (LVD), Art. 17(1) | EU-01 |
| https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32011L0065 | browser | OK; Directive 2011/65/EU (RoHS), Art. 4(1) and Annex II as published (later amendments not checked) | EU-02 |
| https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32005L0029 | browser (2026-11-01; curl gets HTTP 202 with an empty body) | OK; Directive 2005/29/EC (UCPD), Annex I points 2 and 4 | EU-03, EU-04 (reference) |
| https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024L0825 | browser (2026-11-01) | OK; Directive (EU) 2024/825, new Annex I point 4a; Art. 4: applies from 27 September 2026 | EU-05 (reference) |
| https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R0988 | browser (2026-11-01) | OK; Regulation (EU) 2023/988 (GPSR), Art. 19 | EU-06 (reference) |
| https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32004R1935 | browser (2026-11-01) | OK; Regulation (EC) 1935/2004, Art. 3(1) and Art. 15(1)(a) (original text) | EU-07, EU-08 (reference) |
| https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32012L0019 | browser (2026-11-01) | OK; Directive 2012/19/EU (WEEE), Art. 14(4); Art. 3(1)(f)(iv) makes third-country distance sellers "producers" | EU-09 (reference) |
| https://www.meti.go.jp/english/policy/economy/consumer/pse/ | curl | OK; METI page, "Last updated: 2023-04-13"; does not list air fryers by name | JP-01, JP-02 |
| https://eec.eaeunion.org/upload/medialibrary/269/TR-TS-Downvolt.pdf | curl + pdftotext | OK; TR CU 004/2011, Art. 3(3) and Art. 4(5), linked from the EEC page on the regulation | EA-01, EA-02 |
| https://son.gov.ng/soncap-faq/ (from https://son.gov.ng/?p=1000) | curl | OK; SON "SONCAP FAQ" page | NG-01 |

The market profiles in `data/markets.json` (which certification each demo product lacks in each market, power and plug) are invented demo data, like the rest of the factory card.

# Added 2026-10-31 (evening): rules for the 11-platform listing

The listing page now offers 11 platforms. Rules for the new ones, checked the same way: the excerpt was searched for in the fetched page text after whitespace normalisation, and an altered control string was not found. curl pages through an HTML-to-text script (Mercado Libre's policy page is cp1252); JS-rendered pages (Amazon Seller Central, AliExpress) and eBay (which shows scripts a captcha, not bypassed) in a browser with `innerText.includes()`.

**Existing rules extended to new platforms (no new excerpt):**
- AMZ-01..04 now also cover amazon_uk, amazon_de, amazon_jp. The same Seller Central page says: "Title requirements apply to all product types, except media product types, listed in all stores, except for Saudi Arabia, Egypt, Türkiye, and the United Arab Emirates." The UK, DE and JP versions of the page were also opened and show the 75-character sentence.
- US-01..04 also cover walmart_us; MX-01..03 cover mercadolibre_mx; EU-01/02 cover amazon_de; JP-01 covers amazon_jp. These are national rules for the market the platform sells into. The rule sets of amazon_us, tiktok_mx and alibaba_rfq are unchanged (a test pins them), so recorded replays still match.

| URL | How fetched | Status | Rules |
|---|---|---|---|
| https://sellercentral.amazon.de/help/hub/reference/external/GYTR6SYGFA5E3EQC | browser | OK; German promotional examples | AMZ-DE-01 |
| https://sellercentral.amazon.co.jp/help/hub/reference/external/GYTR6SYGFA5E3EQC | browser | OK; Japanese promotional examples | AMZ-JP-01 |
| https://www.ebay.com/help/selling/listings/listing-tips/optimising-listings-best-match?id=4166 | browser | OK; the 80-character line is in the Best Match tips | EBAY-01 |
| https://www.ebay.com/help/policies/listing-policies/search-manipulation-policy?id=4243 | browser | OK | EBAY-02 |
| https://www.ebay.com/help/policies/payment-policies/offering-buy-sell-outside-ebay-policy?id=4272 | browser | OK | EBAY-03 |
| https://help.etsy.com/hc/en-us/articles/115015628707-How-to-Create-a-Listing | curl | OK | ETSY-01 |
| https://help.etsy.com/hc/en-us/articles/23948763872151-Does-Etsy-Allow-Drop-Shipping-or-Reselling | curl | OK | ETSY-02 |
| https://marketplacelearn.walmart.com/guides/Item%20setup/Item%20content,%20imagery,%20and%20media/Product-Detail-Page:-overview | curl | OK; "Product details policy", "Last updated on Oct 6, 2026" | WMT-01..03 |
| https://developers.mercadolibre.com.mx/es_ar/publica-productos | curl | OK; developer docs, given as recommendations; /es_ar/ locale | ML-01, ML-02 |
| https://api.mercadolibre.com/categories/MLM120037 | curl | OK; "Teteras Eléctricas", `max_title_length` 60 (air fryer, ironing and juicer categories also 60) | ML-01 (the limit) |
| https://www.mercadolibre.com.mx/seguro_publicacion.html | curl (cp1252) | OK; "Políticas de Publicación", undated | ML-03 |
| https://rule.aliexpress.com/rule-channels/36963666/122523152 | browser | OK; 《全球速卖通商品发布规范》, 修订日期 北京时间2026/04/29 | AE-01..03 |

Research for eBay, Etsy, Shopify, Walmart, Mercado Libre and AliExpress was done by two helper agents; every excerpt above was then re-fetched and checked here before it went in.

**Not used:**
- Shopify: the Acceptable Use Policy (https://www.shopify.com/legal/aup) has no rule about listing content. shop.com content policies cover only the Shop app channel. So Shopify listings get the factory-card checks only.
- eBay "add a title" help page (id=4648): captcha, not bypassed.
- Etsy Creativity Standards (etsy.com/legal/creativity): HTTP 403 without JavaScript; not checked.
- Mercado Libre "60 caracteres" as prose: found only on the Chile site, so ML-01 cites the category API instead.
- AliExpress 128-character title maximum: often cited, not found on an official page. The quality-score rule (titles of 15 characters or fewer lose points) was found but not added, because it is a score penalty, not a publishing rule.
- Amazon UK: no UK-specific compliance rule (UKCA) was added.
- EU-03..09 (added 2026-11-01 after a visitor in EU trade asked for more EU coverage) are reference rules: `check.kind = "reference"`. They are shown in the rule base with their verbatim excerpt but `rules_for` never returns them, so no check and no model prompt changes and recorded replays still match (a test pins this). Wiring them into the review would change the amazon_de / alibaba_rfq EU prompts and needs a re-recording.
