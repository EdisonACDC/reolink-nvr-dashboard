## 2.0.0-beta.9

- Legge canali presenti, porta RTSP e percorsi video dichiarati dall’NVR, senza conservare le credenziali restituite dal dispositivo. I comandi non supportati mantengono i percorsi alternativi.
- Registrazione con tentativi sui percorsi alternativi e trasporti TCP/UDP; riconnessione se il flusso si interrompe o non avanza.
- Diretta H.264/HLS dal sub-stream, con risoluzione e numero di thread limitati per la compatibilità mobile.
- Indicatore REC basato sull’avanzamento video e su file realmente scritti. Canali NVR vuoti esclusi dalla registrazione e dalla diretta.
- Elenco filmati con verifica FFprobe e durata reale; file ancora aperti o non validi esclusi. I file aperti non vengono cancellati dalla pulizia automatica.
- Riproduzione H.264/HLS temporanea dei filmati H.265; download dell’originale invariato. Al massimo due sessioni di riproduzione e pulizia automatica della cache.
- Arresto del server attende la chiusura dei registratori; comandi dei filmati visibili anche sui telefoni.

# 2.0.0-beta.8

- Avvio live condiviso tra richieste: nessuna interruzione prematura dopo 8 secondi.
- Fino a 25 secondi per tentativo, timeout RTSP di 15 secondi e fallback da TCP a UDP.
- Avanzamento visibile senza lasciare richieste HTTP lunghe aperte attraverso Home Assistant.
- Directory separate per ogni tentativo; le richieste dei segmenti non riavviano il flusso.
- Dettagli tecnici richiudibili per mantenere visibile il pulsante Riprova sul telefono.

# 2.0.0-beta.7

- Corretto il timeout RTSP di FFmpeg per video live, registrazioni e istantanee: eliminato l’errore «Option rw_timeout not found».
- Contenuto dei messaggi video mantenuto entro la larghezza della card su iPhone.

# 2.0.0-beta.6

- Lettore sempre montato: Riprova riavvia il video dopo un errore.
- HLS nativo preferito su iPhone; errori del backend visibili nella card.
- Altezza video stabile e barra comandi adattata agli schermi piccoli.
- Le etichette per canale indicano funzioni abilitate, non confermano una registrazione in corso.

# 2.0.0-beta.5

- Ogni login di verifica chiude la propria sessione con Logout.
- Salvataggio, sincronizzazione e controlli periodici condividono le verifiche ravvicinate e non eseguono login simultanei.
- In caso di errore, attesa di almeno un minuto prima di riprovare con la stessa configurazione.
- Il messaggio «max session» distingue il limite di sessioni da password errata e problemi di rete.
- La plancia non indica più automaticamente «NVR non raggiungibile» per qualsiasi errore di accesso.

Le sessioni accumulate dalla versione precedente possono rimanere attive fino alla scadenza. Il telefono può collegarsi da remoto: è Home Assistant che comunica con il NVR.

