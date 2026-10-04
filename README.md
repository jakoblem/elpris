# Elpris

En enkel, reklamefri og mobilvenlig visning af day-ahead elpriser for **DK1 (vest), DK2 (øst) og SE4 (syd)**.

Live side: https://jakoblem.github.io/elpris/

## Funktioner

- 15-minutters spotpriser for de kommende timer
- 1-timesvisning som gennemsnit af fire 15-minutterspriser
- Tabel som standard samt interaktiv graf
- DK1, DK2 og SE4 fra Energinets DayAheadPrices
- Alle viste priser afrundes til nærmeste hele øre/kWh
- Automatisk hentning af morgendagens priser efter day-ahead-publiceringen
- Automatisk genindlæsning af prisdata på en åben side
- Ca. forbrugerpris inkl. variable tariffer, afgifter og moms
- Automatisk tidsafhængig nettarif for en række danske netselskaber
- Standard-nettarif baseret på medianen af de tilgængelige udvalgte netselskaber
- Separat postnummer gemt lokalt for DK1, DK2 og SE4
- Daglig SEK/DKK-kurs til SE4-beregningen
- Farveblind-venlig tabelskala fra blå (billigere) til orange (dyrere)
- Automatisk markering af den billigste sammenhængende 5-timersblok som **oplad**
- Ingen annoncer eller tracking

## Prisområder

Siden viser:

- **DK1 (vest)** – Vestdanmark
- **DK2 (øst)** – Østdanmark
- **SE4 (syd)** – Sydsverige

Område, visning, interval, postnumre og tarifvalg gemmes lokalt i browseren.

## Spotpriser

Spotpriser hentes fra Energinets **Energi Data Service**, datasættet `DayAheadPrices`.

Energinets priser i DKK/MWh omregnes til øre/kWh. SE4-spotprisen anvendes også i DKK, så alle tre områder kan sammenlignes direkte.

Kilde: Energinet, Energi Data Service. Data anvendes under CC BY 4.0.

## 15 minutter og 1 time

Day-ahead-dataene er i 15-minutters opløsning.

Ved **1 time** beregner siden timeprisen som gennemsnittet af de fire underliggende kvarterspriser. Ved tryk på grafen vises det nærmeste underliggende 15-minuttersinterval og dets pris, også når grafen står på timevisning.

## Ca. forbrugerpris i Danmark

For DK1 og DK2 beregnes den variable ca. forbrugerpris som:

```
spotpris
+ nettarif
+ nationale variable tariffer/elafgift
+ eventuelt leverandørtillæg
+ moms
```

Faste månedlige abonnementer er ikke medregnet i øre/kWh-prisen.

### Netselskaber og transport

Nettariffer hentes automatisk fra Energinets datasæt `DatahubPricelist`.

Siden indeholder profiler for en række almindelige danske netselskaber, bl.a. Radius, Cerius, N1, Konstant, TREFOR El-net, Dinel og Nord Energi Net, når gyldige data findes i DataHub.

Hvis brugeren ikke vælger et netselskab, anvendes en **standardprofil baseret på medianen** af de tilgængelige udvalgte netselskaber.

Tariffer vælges efter deres `ValidFrom` og `ValidTo`. Dermed kan siden håndtere prisændringer og sæsonskift, fx når en nettarif ændres 1. april eller 1. oktober. Tarifvalget foretages ud fra tidspunktet for det enkelte prisinterval og ikke kun ud fra datoen, hvor data blev hentet.

Brugeren kan stadig overskrive tarifværdier manuelt.

## Postnumre

Der gemmes tre uafhængige postnumre i browserens lokale lager:

- postnummer for DK1
- postnummer for DK2
- postnummer for SE4

Det gør det muligt senere at koble hvert område til det relevante lokale netselskab uden at et postnummer i ét område overskriver de andre.

Der findes foreløbig kun konservative automatiske forslag for områder, hvor sammenhængen er tilstrækkeligt sikker. Netselskabet kan altid vælges manuelt.

## SE4 og svensk forbrugerpris

SE4 vises i **DKK**, ligesom DK1 og DK2.

Ved ca. forbrugerpris lægges svenske variable afgifter, et estimeret net-/leverandørtillæg og svensk moms til spotprisen. Beløb i SEK omregnes til DKK.

SEK/DKK-kursen hentes automatisk fra **Danmarks Nationalbank** og gemmes i `data/fx.json`. Der anvendes den senest tilgængelige indikative valutakurs.

Den svenske netdel er fortsat et estimat, fordi nettariffen afhænger af det lokale svenske netselskab.

## Tabel og opladning

Tabelvisningen bruger en relativ femtrins-skala for de kommende 24 timers priser:

**mørk blå → lyseblå → neutral → lys orange → mørk orange**

Skalaen er relativ til priserne i det viste døgn og er valgt for at være mere anvendelig ved almindelige former for farvesynsvariation end en ren grøn/rød-skala.

Ved 1-timesvisning finder siden desuden den billigste sammenhængende **5-timersblok** og markerer den med tekst og kant som **oplad**. Farve er dermed ikke det eneste signal.

## Automatisk opdatering

GitHub Actions-workflowet `.github/workflows/update-and-deploy.yml` opdaterer:

- `data/prices.json` – spotpriser
- `data/tariffs.json` – danske nettariffer
- `data/fx.json` – SEK/DKK

Omkring day-ahead-publiceringen kontrolleres spotpriserne gentagne gange. Datafiler committes kun, når indholdet faktisk har ændret sig.

Workflowet kan også startes manuelt fra fanen **Actions**.

Når siden allerede står åben i browseren, kontrollerer den med mellemrum, om der er kommet nye spotprisdata.

## GitHub Pages

Siden publiceres med GitHub Pages fra:

- Branch: **main**
- Folder: **/(root)**

Nye commits på `main` bliver automatisk publiceret af GitHub Pages.

## Begrænsninger

Den viste ca. forbrugerpris er et **estimat**, ikke en faktura eller et pristilbud.

Den præcise slutpris kan bl.a. afhænge af:

- konkret netselskab og tarifgruppe
- elaftale og leverandørtillæg
- faste abonnementer
- særlige rabatter eller produkter
- lokale svenske netpriser for SE4
- ændringer i skatter, afgifter og tariffer

Brug derfor totalprisen som et praktisk estimat til fx planlægning af elbilopladning og andet fleksibelt forbrug.
