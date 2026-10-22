# Handover: AI Agent Control Center

## 1. Syfte
Bygg en visuellt trovärdig, kontinuerligt levande webbapplikation som simulerar ett kontrollcenter där många AI-agenter arbetar parallellt. Den ska visas på en informationsskärm som öppnar en webbadress. Detta är **en visuell simulering**, inte en riktig agentplattform, och ska inte kräva AI-API, backend eller internetuppkoppling efter sidladdning.

**Målbild:** En professionell drift-/utvecklingsmiljö med många samtidiga agenter, terminalflöden, uppgiftsköer och realtidsstatistik. Undvik överdriven sci-fi-estetik. Betraktaren ska på några sekunder förstå att mycket arbete pågår samtidigt.

## 2. Leverans och tekniska ramar
- En statisk webbapp, gärna TypeScript + Vite (alternativt ren HTML/CSS/JS om enklare).
- Kan hostas på valfri statisk webbserver och visas via URL i en infoskärms webbläsare.
- Inga externa API:er, databaser, typsnitt/CDN-beroenden eller autentisering.
- Layout primärt för 16:9, 1920×1080, men adaptiv för 4K och andra skärmstorlekar.
- Autostart vid sidladdning, helskärmsliknande kioskvy, utan scrollbars och utan krav på användarinteraktion.
- Kör kontinuerligt i minst 24 timmar utan växande minnesanvändning eller betydande prestandaförsämring.
- Ingen faktisk kodexekvering, shell-access eller nätverkstrafik från de simulerade agenterna.

## 3. Visuell design
- Mörkt, nedtonat kontrollcenter: grafit/svart bakgrund, tydliga panelgränser, diskreta gröna/blå statusaccentfärger och monospace för loggar.
- Trovärdig produkt-UI snarare än filmiskt hackergränssnitt. Ingen 3D, neonstorm, överdriven glow eller orealistisk 'matrix rain'.
- Skärmen ska kännas aktiv även på avstånd: synliga statusväxlingar, uppgiftsräknare och varierande flöde. Undvik för små texter i de viktigaste KPI:erna.
- Inga fotografier, människor eller fysisk datorskärm: bara gränssnittet.

### Layout (förslag)
1. **Header (ca 6–8 % höjd):** produktnamn `AGENT CONTROL CENTER`, simulerad systemstatus, lokal klocka och upptid.
2. **Vänsterkolumn (ca 23 % bredd):** agentpool med 30–50 agenter, namn/ID, aktuell uppgift, status och diskret aktivitetsindikator. Scrolla/rotera listan automatiskt utan ryckiga hopp.
3. **Mittkolumn (ca 52 % bredd):** 6–9 kompakta terminalpaneler i rutnät. Varje panel tillhör en agent och visar semantiskt sammanhängande loggar som fylls på över tid.
4. **Högerkolumn (ca 25 % bredd):** kö med aktuella/nyligen avslutade jobb, KPI:er (aktiva agenter, slutförda uppgifter, ködjup, fel/omförsök, genomströmning) och liten historikgraf.
5. **Footer (valfritt):** lågmäld händelseström med större systemhändelser.

Använd CSS Grid. Paneler ska hålla sig inom viewporten; innehåll kapas eller internscrollas kontrollerat.

## 4. Simuleringsmotor
### Agenter
- Starta med cirka 30 agenter, konfigurerbart till 50 eller fler.
- Varje agent har unikt ID, roll, aktuellt jobb, status, tillstånd, tidsstämplar och en begränsad loggbuffert.
- Roller kan vara `Code`, `QA`, `Security`, `Data`, `Infrastructure`, `Research`, `Documentation`, `Deployment`.
- Tillståndsmaskin: `idle -> assigned -> analyzing -> planning -> executing -> validating -> completed`.
- Vid validering kan en mindre andel gå till `retrying`, därefter tillbaka till `executing` eller slutligen `failed`. Även misslyckade jobb ska frigöra agenten.
- Tidsåtgång varierar efter uppgiftens komplexitet och agentroll. Agenter arbetar asynkront; undvik synkroniserade massuppdateringar.

### Uppgifter
- Skapa uppgifter från en större uppsättning realistiska mallar (minst 60 unika titlar/loggsekvenser), gärna kombinerade med projektnamn, filnamn, moduler och varierande antal.
- Exempel: analysera Laravel-controller, optimera SQL-query, köra PHPUnit, kontrollera CI-pipeline, generera API-dokumentation, granska beroenden, verifiera deployment, indexera dokument, testa autentisering.
- Varje uppgift ska ha en sammanhängande loggsekvens, inte helt slumpade fraser rad för rad.
- Uppgiftskö och arbetsfördelning styrs av en scheduler. Simulerade beroenden får skapa deluppgifter och underagenter (utan att överskrida resursgränser).
- Begränsa antal samtidiga uppgifter och mängden köade jobb; skapa nya jobb efter behov.

### Variation
- Använd en seedbar PRNG så samma scenario kan reproduceras vid felsökning (`?seed=1234`), men slumpmässig seed normalt.
- Variera loggtempo, uppgiftslängd, väntetider, agentbelastning, resultat och uppgiftstyper.
- Låt belastningen röra sig långsamt mellan lugnare och intensivare perioder, t.ex. en övergripande belastningsnivå som förändras var 1–3 minut.
- Sällsynta större händelser: batchjobb, deluppgiftsfördelning, tillfällig köökning, fel följt av återhämtning.
- Undvik att alla agenter avslutar samtidigt eller att samma meddelanden upprepas synligt.

## 5. Trovärdig terminalaktivitet
- Terminaltext ska likna verkliga utvecklar- och driftverktyg utan att imitera en faktisk liveanslutning.
- Exempel på sekvens:
  ```text
  13:42:06 [agent-014] Assigned: Optimize invoice query
  13:42:07 [analysis] Inspecting query plan for invoices_summary
  13:42:09 [db] Scanned 18,420 rows; candidate index identified
  13:42:11 [patch] Updated migration and query builder
  13:42:13 [test] Running 48 integration tests
  13:42:17 [test] PASS 48/48
  13:42:18 [done] Completed in 12.1s
  ```
- Använd syntetiska projektnamn och data. Visa inga verkliga kunduppgifter, API-nycklar, IP-adresser eller känsliga värden.
- Terminalpaneler visar bara de senaste ca 12–25 raderna och följer automatiskt senaste raden. Begränsa skrivanimationer så de inte blir CPU-tunga.
- Tidsstämplar och statistik ska vara konsekventa med simulerad tid och faktiska tillstånd.

## 6. KPI:er och grafer
- `Active agents`: antal agenter i aktiva tillstånd.
- `Tasks completed`: monotont ökande under en session.
- `Queue depth`: faktiskt antal väntande uppgifter i simulatorn.
- `Success rate`: beräknad från avslutade uppgifter, inte hårdkodad.
- `Throughput`: avslutade uppgifter per senaste 60 sekunderna.
- `Retries`: antal verkliga omförsök i simuleringsmotorn.
- Historikgraf med rullande fönster, t.ex. 5 minuter. SVG eller Canvas räcker; använd inte tungt diagrambibliotek om det inte behövs.
- Om sidan laddas om får en ny session starta från noll; eventuell persistens är valfri, inte nödvändig.

## 7. Arkitekturförslag
Dela upp i:
- `SimulationEngine`: äger agenter, jobb, tillståndsövergångar och schemaläggning.
- `TaskTemplates`: realistiska jobbmallar och sammanhängande loggsekvenser.
- `EventBus` eller enkel eventkö: ändringar som UI kan prenumerera på.
- `Dashboard`: läser ett härlett snapshot av simuleringsläget.
- `TerminalGrid`, `AgentList`, `TaskQueue`, `Metrics`, `ActivityChart`.
- `Config`: agentantal, tempo, seed, loggbuffert, belastningsprofil.

Håll simulatorns logik separerad från DOM/rendering så den går att testa deterministiskt. Använd en central scheduler och undvik en timer per loggrad eller agent. Uppdatera UI i begränsad takt (t.ex. 4–10 gånger/sekund för text/status, graf ca 1 gång/sekund). Pausa eller dra ned aktiviteten när sidan är dold, men hantera återkomst utan att försöka rendera tusentals gamla events.

## 8. Driftkrav
- Ringbuffertar för loggar, köhistorik och grafdata.
- Rensa avslutade uppgifter ur aktivt tillstånd efter kort historikperiod.
- Maxgränser för samtidiga agenter, ködjup, DOM-noder och historikpunkter.
- Hantera långvarig drift, tab-suspension, tidshopp och ändrad skärmupplösning.
- Stöd `prefers-reduced-motion` och valfri `?speed=...` för demo/test.
- Lägg till en enkel felgräns så ett simuleringsfel inte gör hela skärmen blank.
- Inga nätverksanrop efter att statiska resurser laddats.

## 9. Konfiguration och acceptanskriterier
Exempel på URL-parametrar:
- `?agents=40`
- `?seed=1234`
- `?speed=1.5`
- `?density=high`

**Godkänt när:**
1. En statisk build kan öppnas från en vanlig webbserver utan backend.
2. Inom 10 sekunder syns tydlig aktivitet hos flera oberoende agenter.
3. Agenter och jobb följer rimliga tillståndsövergångar; KPI:erna stämmer med motorns data.
4. Fel, omförsök och underuppgifter inträffar ibland, men dominerar inte.
5. UI fyller 16:9 utan sidscrollning och är begripligt på en stor informationsskärm.
6. Samma seed ger samma simulerade händelseförlopp givet samma konfiguration och simulerad tidsmodell.
7. Ingen växande mängd DOM-noder, loggrader eller jobb under långvarig körning.
8. Inga riktiga kommandon, externa API-anrop eller verkliga person-/kunduppgifter.

## 10. Implementationsordning
**Fas 1 – MVP:** layout, 30 agenter, central scheduler, 10 uppgiftstyper, 6 terminalpaneler, korrekta KPI:er.

**Fas 2 – Trovärdighet:** minst 60 mallar, varierande tidsförlopp, fel/omförsök, deluppgifter, 5-minutersgraf och belastningsvariation.

**Fas 3 – Produktionshärdning:** seed, URL-konfiguration, responsiv kioskvy, 24-timmars soak test, optimering och återhämtning efter browser-suspension.

## 11. Startinstruktion till kodagent
> Implementera specifikationen som en körbar statisk webbapp. Börja med en komplett MVP som går att starta lokalt och bygga för statisk hosting. Prioritera en professionell, trovärdig och tät dashboard, semantiskt sammanhängande terminalflöden och en robust simuleringsmotor. Visa tydligt vilka filer som skapats och hur projektet startas och byggs. Undvik backend och externa tjänster. Efter MVP: utöka uppgiftsmallar och långtidshärdning.
