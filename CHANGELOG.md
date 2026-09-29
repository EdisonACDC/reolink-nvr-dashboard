# 2.0.0-beta.5

- Ogni login di verifica chiude la propria sessione con Logout.
- Salvataggio, sincronizzazione e controlli periodici condividono le verifiche ravvicinate e non eseguono login simultanei.
- In caso di errore, attesa di almeno un minuto prima di riprovare con la stessa configurazione.
- Il messaggio «max session» distingue il limite di sessioni da password errata e problemi di rete.
- La plancia non indica più automaticamente «NVR non raggiungibile» per qualsiasi errore di accesso.

Le sessioni accumulate dalla versione precedente possono rimanere attive fino alla scadenza. Il telefono può collegarsi da remoto: è Home Assistant che comunica con il NVR.
