# Reolink NVR Dashboard

Add-on Home Assistant che trasforma il mini-PC in un NVR autonomo per
telecamere IP. Il registratore Reolink fisico rimane supportato solo come
modalità di migrazione opzionale.

## Versione 2.0 beta

- Live view HLS con griglie da 1, 4, 9 o 16 telecamere.
- Telecamere autonome tramite flussi RTSP principali e secondari.
- Registrazione continua senza ricodifica, in segmenti MP4 da cinque minuti.
- Riproduzione, calendario e download delle registrazioni.
- Conservazione automatica oppure per un numero configurabile di giorni.
- Archivio selezionabile sotto `/media`, `/share` o `/data`.
- Riserva disco combinata in GB e percentuale per proteggere Home Assistant.
- Eliminazione circolare dei filmati più vecchi e arresto di sicurezza.
- Riavvio automatico dei processi di registrazione interrotti.
- Credenziali RTSP mai restituite al browser o mostrate nei log.

## Collegamento senza NVR fisico

Le telecamere PoE devono essere collegate a uno switch PoE sulla stessa rete
del mini-PC. Ogni telecamera deve fornire un flusso RTSP locale; i dispositivi
esclusivamente cloud non possono effettuare registrazione continua locale.

La registrazione su movimento/ONVIF è indicata nell'interfaccia come funzione
del prossimo aggiornamento beta. In questa release la modalità affidabile è la
registrazione continua 24/7.
