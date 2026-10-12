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

SEK/DKK-kursen hentes automatisk fra **Danmarks Nationalbanks dokumenterede XML-feed** og gemmes i `data/fx.json`. Feedets pris i DKK pr. **100 SEK** divideres med 100. Der anvendes den senest offentliggjorte indikative kurs; det er ikke en transaktionskurs.

- [Nationalbankens dokumentation og XML-links](https://www.nationalbanken.dk/da/vores-arbejde/stabile-priser-pengepolitik-og-dansk-oekonomi/valutakurser)
- [Dagligt XML-feed](https://www.nationalbanken.dk/api/currencyratesxml?lang=da)

`rate_date` er kildens observationsdato, mens `generated_at` er tidspunktet for den seneste ændring af den gemte observation. Samme kurs på en ny observationsdato opdaterer derfor filen. Weekend og helligdage kan genbruge seneste bankdags kurs; observationer over syv kalenderdage gamle, fremtidige datoer, manglende/dobbelte SEK-rækker, forkert referencevaluta og kurser uden for sikkerhedsintervallet 40–100 DKK pr. 100 SEK afvises. Ved afvisning eller netværksfejl bevares filen, og Actions melder fejl. En varig kursændring uden for sikkerhedsintervallet kræver manuel vurdering af grænserne.

Den svenske netdel er fortsat et estimat, fordi nettariffen afhænger af det lokale svenske netselskab.

## Tabel og opladning

Tabelvisningen bruger en relativ femtrins-skala for de kommende 24 timers priser:

**mørk blå → lyseblå → neutral → lys orange → mørk orange**

Skalaen er relativ til priserne i det viste døgn og er valgt for at være mere anvendelig ved almindelige former for farvesynsvariation end en ren grøn/rød-skala.

Ved 1-timesvisning finder siden desuden den billigste sammenhængende **5-timersblok** og markerer den med tekst og kant som **oplad**. Farve er dermed ikke det eneste signal.

## Automatisk opdatering

GitHub Actions-workflowet `.github/workflows/update-and-deploy.yml` henter og validerer:

- `data/prices.json` – spotpriser fra Energinet
- `data/tariffs.json` – danske nettariffer fra Energinet
- `data/fx.json` – SEK/DKK fra Nationalbankens XML-feed

Planen bruger UTC: hvert femte minut fra **11.02 til 17.57 UTC**, samt **23 minutter over hver time uden for dette vindue**. Vinduet dækker både sommer-/vintertid og forsinket offentliggørelse. Ved manglende priser fra kl. 13 dansk tid forsøger pris-scriptet højst tre gange med 60 sekunders mellemrum. Hvert HTTP-kald har en timeout på 30 sekunder og højst tre forsøg ved netværksfejl, HTTP 429 eller 5xx. Hele jobbet har en timeout på 20 minutter.

GitHub planlægger kørsler efter bedste evne: `schedule` kan være forsinket eller bortfalde. Udvidet tidsvindue, timevis fallback og genforsøg forbedrer genopretningen, men garanterer ikke et bestemt leveringstidspunkt. `concurrency` hindrer samtidige dataopdateringer; en ventende kørsel kan erstattes af en nyere. Hver kørsel henter seneste `main`, så et gammelt kø-event ikke starter fra gamle data.

### Dækning og fejlstatus

Priser valideres pr. område og dansk kalenderdag. Et helt døgn kræver præcis de korrekte, unikke UTC-tidspunkter med 15 minutters mellemrum: normalt 96, **92 ved overgang til sommertid** og **100 ved overgang til vintertid**. Dubletter, ugyldige tidspunkter, ikke-endelige tal og trunkerede API-svar afvises. Negative spotpriser er gyldige. EDS-parametrene `start` og `end` er danske lokale datoer; slutdatoen er eksklusiv.

Et delvist eller manglende nyt døgn erstatter aldrig et tidligere komplet døgn for samme område/dato. Kun komplette døgn publiceres. Dagens priser skal være komplette i alle områder før en ny prisfil kan skrives. Uden komplette priser for i morgen vises en advarsel frem til **kl. 15.00 Europe/Copenhagen**; fra dette tidspunkt fejler pris-trinnet. Dette er projektets kontrolfrist, ikke et løfte om kildens publiceringstid. Gyldige priser for i dag kan stadig gemmes, selvom morgendagen mangler.

`coverage` indeholder dato, forventet antal, antal pr. område og komplet-status for både i dag og i morgen. Actions viser dækning, valutadato og hvert trins resultat i kørselsresuméet. Ingen fil erstattes, før indholdet er serialiseret og valideret; filudskiftningen er atomisk. Tariffiler afvises, hvis de er tomme, indeholder ugyldige priser eller mister tidligere stadig gyldige selskabsprofiler.

Fejl i én datakilde stopper ikke de øvrige kilder eller publicering af deres gyldige ændringer. Sidste trin markerer dog **hele kørslen som fejlet**, hvis en hentning, commit eller Pages-publicering fejlede. Tidligere data kan derfor stadig være synlige under et kildeudfald; en bevaret fil er ikke bevis på aktuelle data. Datafiler committes kun ved indholdsændring. `generated_at` er ændringstidspunkt, ikke heartbeat for hver kontrol.

### Manuel genopretning og test

Start **Opdater elpriser, tariffer og valuta** fra fanen Actions med branch `main`, eller:

```sh
gh workflow run update-and-deploy.yml --repo jakoblem/elpris --ref main
```

Manuel start på en feature-branch springer opdateringsjobbet over. Lokalt kræves Python 3.12 med IANA-tidszoner og ingen Python-pakker:

```sh
python -m unittest discover -s tests -v
python scripts/fetch_prices.py --attempts 3 --poll-seconds 60
python scripts/fetch_fx.py
python scripts/fetch_tariffs.py
```

Testene kræver ikke netværk og dækker blandt andet sommertid, dubletter, ufuldstændige døgn, genforsøg, atomiske skriverier, ugyldige valutakurser, bevarelse af data og Pages-kontrol. `.github/workflows/tests.yml` kører testene på pull requests og relevante pushes. Når siden står åben, kontrollerer den fortsat periodisk for nye spotpriser.

Hvis ingen workflows starter, kan de heller ikke selv rapportere kildefejl. Ved krav om en fast leveringstid skal en **uafhængig scheduler/monitor** overvåge `coverage` og eventuelt kalde `workflow_dispatch` med en særskilt, passende begrænset GitHub-legitimationsoplysning. En sådan ekstern tjeneste er ikke konfigureret i dette repository.

## GitHub Pages

Den eksisterende publiceringskilde bevares: **Deploy from a branch → main → /(root)**. Almindelige pushes publiceres som hidtil. Et push med Actions' `GITHUB_TOKEN` er ikke i sig selv en garanti for et Pages-build. Derfor kalder `scripts/publish_pages.py` Pages' officielle build-API med `pages: write`, når den aktuelle commit ikke allerede er bygget, og venter op til cirka fem minutter på status `built` for netop denne commit. Eksisterende igangværende builds genbruges. Manglende eller fejlet publicering gør kørslen rød; næste kørsel forsøger igen, også når datafilerne er uændrede.

Ingen ekstra PAT eller ændring af Pages-kilden er nødvendig. GitHub CLI (`gh`) er installeret på den anvendte Ubuntu-runner. Et lokalt kald af Pages-scriptet kræver en autentificeret CLI samt `GITHUB_REPOSITORY` og skriver til den eksisterende Pages-side.

- [GitHub: planlagte events og begrænsninger](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub: GITHUB_TOKEN og Pages-builds](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- [GitHub: anmod om Pages-build](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build)
- [Energinet: API-guide og datoparametre](https://www.energidataservice.dk/guides/api-guides)

## Hændelsen 12. oktober 2026

Den kontrollerede kørsel [38238179751](https://github.com/jakoblem/elpris/actions/runs/38238179751) var udløst af `schedule` kl. 10.44.09 UTC. Jobbet kørte cirka syv sekunder. Pris-trinnet loggede `No new price data; leaving prices.json unchanged.`; kun tariffilen blev committet. Den grønne status kontrollerede altså ikke, om morgendagen var tilgængelig.

Ved undersøgelsen viste Actions-API'et stadig ingen senere dataopdateringskørsler. Workflowet var `active` på `main`, cron-udtrykkene var gyldige, og ingen af de registrerede schedule-kørsler var ventende eller annullerede. Der var også store mellemrum mellem planlagte kørsler på de foregående dage. Det peger på forsinkede/udeblevne GitHub schedule-events, ikke et langt kørende pris-script. API'et udstiller ikke årsagen til events, der aldrig blev til kørsler; en præcis platformårsag kan kun bekræftes af GitHub. Den automatiske deaktivering efter 60 dages inaktivitet forklarer ikke et aktivt repository med aktuelle kørsler.

En efterfølgende direkte kildekontrol fandt alle 96 intervaller for **13. oktober i DK1, DK2 og SE4**. Der er ikke belæg for at fastslå, præcis hvornår kilden offentliggjorde dem. Valutaproblemet skyldtes separat, at workflowet aldrig kaldte det eksisterende FX-script; HTML-parseren er nu erstattet af det dokumenterede XML-feed.

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

## Publicering

GitHub Pages publicerer fra `main`. Dataworkflowet gemmer validerede ændringer og kontrollerer, at deres commit bliver bygget af Pages.
