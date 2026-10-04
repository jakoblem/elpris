# Elpris

En enkel, reklamefri og mobilvenlig visning af day-ahead elpriser for **DK1, DK2 og SE4**.

## Funktioner

- 15-minutterspriser
- 1-timesvisning som gennemsnit af fire kvarterspriser
- Graf og tabel
- DK1, DK2 og SE4 fra samme datakilde
- Automatisk opdatering via GitHub Actions
- Valgfri, lokal beregning af ca. forbrugerpris for DK1/DK2
- Ingen cookies, annoncer eller tracking

## Data

Spotpriser hentes fra Energinets **Energi Data Service**, datasættet `DayAheadPrices`.
API-værdier i DKK/MWh omregnes til øre/kWh.

Kilde: Energinet, Energi Data Service. Data anvendes under CC BY 4.0.

## Ca. totalpris

Tarifvisningen er et **estimat**. Nationale tariffer/elafgift har en standardværdi, mens lokal nettarif og elselskabets tillæg kan indtastes af brugeren. Indstillingerne gemmes kun lokalt i browseren. Faste abonnementer er ikke medregnet.

SE4 viser foreløbig spotpris uden svensk net, skat og moms.

## Automatisk opdatering

Workflowet `.github/workflows/update-and-deploy.yml` forsøger at hente nye data hvert femte minut i et tidsvindue omkring den danske day-ahead-publicering. Filen `data/prices.json` ændres kun, når der faktisk er nye prisdata.

Workflowet kan også køres manuelt fra fanen **Actions**.

## GitHub Pages

Aktivér siden én gang under **Settings → Pages**:

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/(root)**

Derefter publicerer GitHub Pages automatisk nye commits på `main`.
