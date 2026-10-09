# Collaudo e correzioni prima della consegna commerciale — 2026-10-09

Stato: **beta**, config.yaml rilevato versione 2.0.0-beta.11. README indica registrazione continua e dichiara rilevazione movimento/ONVIF come funzione futura.

## P0
- Verificare flussi RTSP/HLS live da LAN e via Home Assistant remoto, codec H.264/H.265, credenziali e reconnect.
- Verificare registrazione continuativa: segmenti riproducibili, calendario, esportazione, retention 7 giorni e recupero dopo riavvio/blackout.
- Testare esaurimento SSD: riserva GB/% e eliminazione circolare senza saturare disco Home Assistant.
- Non dichiarare PTZ operativo finché comandi ONVIF/Reolink non sono testati su modello reale; correggere mapping frecce/zoom (zoom non deve cambiare telecamera).

## P1
- Testare autorizzazioni e protezione URL streaming, backup configurazioni, registri e protezione password.
- Chiarire limiti delle telecamere e rete remota; test con NVR fisico solo se quella modalità è effettivamente richiesta.

## Accettazione
Live stabile su 3 dispositivi, 24h di registrazione senza lacune inattese, verifica gestione spazio e retention, replay/download, riavvio e test PTZ su modello supportato. Nessuna garanzia commerciale finché beta non validata.
