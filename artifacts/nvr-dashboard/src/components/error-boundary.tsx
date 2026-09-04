import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * ErrorBoundary globale.
 *
 * In precedenza un qualsiasi errore di rendering (es. l'errore
 * "No QueryClient set" causato da copie duplicate di @tanstack/react-query)
 * faceva fallire l'intero albero React lasciando una schermata completamente
 * NERA senza alcun messaggio, rendendo impossibile capire cosa fosse successo.
 *
 * Con questo boundary un eventuale errore mostra invece un messaggio leggibile
 * e un pulsante per ricaricare, così l'utente non resta mai davanti a uno
 * schermo vuoto senza spiegazioni.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log in console per il debug (visibile negli strumenti sviluppatore).
    console.error("[NVR] Errore di rendering non gestito:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0a0a0c",
            color: "#e5e7eb",
            fontFamily: "Inter, system-ui, sans-serif",
            padding: "1.5rem",
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: 480 }}>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.75rem" }}>
              Si è verificato un errore
            </h1>
            <p style={{ fontSize: "0.9rem", opacity: 0.8, marginBottom: "1rem" }}>
              La dashboard non è riuscita ad avviarsi correttamente. Prova a
              ricaricare la pagina. Se il problema persiste, riavvia l'add-on.
            </p>
            <pre
              style={{
                fontSize: "0.75rem",
                opacity: 0.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                marginBottom: "1.25rem",
              }}
            >
              {this.state.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "0.5rem",
                padding: "0.6rem 1.2rem",
                fontSize: "0.9rem",
                cursor: "pointer",
              }}
            >
              Ricarica
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
