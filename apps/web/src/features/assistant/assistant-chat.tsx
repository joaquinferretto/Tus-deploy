'use client'

import directoryStyles from '../directory/directory.module.css'
import { useAccountView } from '../session/use-account-view'
import { AssistantConversation } from './assistant-conversation'
import styles from './assistant.module.css'
import { useAssistant } from './use-assistant'

// Full-page conversation with the TUS assistant. The message goes to the API, where the SAME
// orchestrator as WhatsApp (model + tools + knowledge base) decides and writes the reply; this
// page has no steps, patterns or canned answers of its own.
export function AssistantChat(): React.ReactNode {
  const account = useAccountView()
  const assistant = useAssistant(account.status !== 'unknown', account.status)

  return (
    <div className={directoryStyles.narrow}>
      <h1 className={directoryStyles.title}>Asistente de TUS</h1>
      <p className={directoryStyles.subtitle}>
        Escribí con tus palabras qué necesitás. El asistente busca profesionales reales, consulta turnos y responde tus dudas sobre TUS. Vos elegís y confirmás cada acción.
      </p>
      <div className={styles.toolbar}>
        <p>{account.status === 'signed-in' ? 'Sesión iniciada: podés solicitar turnos y enviar solicitudes.' : 'Sin sesión podés consultar; para solicitar un turno o contratar vas a tener que iniciar sesión.'}</p>
        <button className={styles.linkButton} disabled={assistant.busy || assistant.messages.length === 0} onClick={assistant.restart} type="button">
          Nueva conversación
        </button>
      </div>
      <section aria-label="Conversación con el asistente de TUS">
        <AssistantConversation assistant={assistant} />
      </section>
    </div>
  )
}
