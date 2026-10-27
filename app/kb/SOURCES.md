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
