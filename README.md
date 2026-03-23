# Reolink NVR Dashboard

  Dashboard web per la gestione e visualizzazione del tuo NVR Reolink.

  ## Funzionalità

  - 📹 **Live View** — Griglia telecamere in tempo reale (1/4/9/16 canali)
  - 🎥 **Registrazioni** — Navigazione con calendario e timeline
  - ⚙️ **Configurazione** — Setup NVR, telecamere e impostazioni
  - 📊 **Stato sistema** — Uso disco, temperatura, stato connessione

  ## Stack Tecnologico

  - **Frontend**: React + Vite + TypeScript + Tailwind CSS
  - **Backend**: Node.js + Express 5
  - **Database**: PostgreSQL + Drizzle ORM
  - **API**: OpenAPI 3.1 con codegen automatico (Orval)

  ## Setup

  ```bash
  pnpm install
  pnpm --filter @workspace/db run push
  pnpm --filter @workspace/api-server run dev
  pnpm --filter @workspace/nvr-dashboard run dev
  ```

  ## Configurazione NVR

  1. Apri la dashboard nel browser
  2. Vai su **Configuration**
  3. Inserisci IP, porta, username e password del tuo NVR Reolink
  4. Aggiungi le telecamere con i relativi canali
  