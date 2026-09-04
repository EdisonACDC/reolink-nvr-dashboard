import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// --- Supporto ingress di Home Assistant ------------------------------------
// Quando la dashboard gira come add-on di Home Assistant viene servita dietro
// un percorso di ingress del tipo `/api/hassio_ingress/<token>/`.
// Il client API generato effettua le richieste verso percorsi ASSOLUTI
// (es. `/api/nvr/cameras`): senza correzione queste richieste ignorano il
// prefisso di ingress e finiscono direttamente su Home Assistant, quindi le
// telecamere (e ogni altra chiamata API) non vengono mai caricate.
// Ricaviamo il percorso base di ingress dalla URL corrente e lo anteponiamo a
// tutte le richieste API. In modalità standalone (servita da `/`) il valore
// risulta vuoto e i percorsi assoluti continuano a funzionare come prima.
function resolveApiBaseUrl(): string {
  let path = window.location.pathname;
  // Rimuove un eventuale nome file finale (es. index.html).
  path = path.replace(/\/[^/]*\.[^/]*$/, "/");
  // Normalizza rimuovendo gli slash finali.
  path = path.replace(/\/+$/, "");
  return path;
}

const apiBaseUrl = resolveApiBaseUrl();
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

createRoot(document.getElementById("root")!).render(<App />);
