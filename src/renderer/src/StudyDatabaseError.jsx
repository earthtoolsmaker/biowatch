import { AlertTriangle, Loader2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from './ui/button.jsx'

/** Also used at the route boundary, before mounting any study-data hooks. */
export function StudyDatabaseGate({ study, children }) {
  return study.database.status === 'ready' ? children : <StudyDatabaseError study={study} />
}

export default function StudyDatabaseError({ study }) {
  const queryClient = useQueryClient()
  const { database } = study
  const newer = database.status === 'newer'
  const canRetry = !['newer', 'incompatible', 'updating'].includes(database.status)
  const diagnostics = JSON.stringify(
    {
      appVersion: database.appVersion,
      studyId: study.id,
      status: database.status,
      currentVersion: database.currentVersion,
      expectedVersion: database.expectedVersion,
      error: database.message
    },
    null,
    2
  )
  const copy = useMutation({ mutationFn: () => navigator.clipboard.writeText(diagnostics) })
  const retry = useMutation({
    mutationFn: () => window.api.retryStudyDatabaseUpdate(study.id),
    onSuccess: async () => {
      copy.reset()
      await queryClient.invalidateQueries({ queryKey: ['studies'] })
    }
  })

  return (
    <section
      className="max-w-2xl mx-auto p-8 space-y-5"
      aria-labelledby="study-database-error-title"
    >
      <AlertTriangle className="text-amber-600 dark:text-amber-400" size={32} aria-hidden="true" />
      <div>
        <h1 id="study-database-error-title" className="text-xl font-semibold text-foreground">
          {newer ? 'This study needs a newer Biowatch version' : 'This study couldn’t be opened'}
        </h1>
        <p className="mt-1 font-medium text-foreground">{study.name}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        {newer
          ? 'Update Biowatch to open this study. Its database will not be downgraded.'
          : 'Its database could not be prepared for this version of Biowatch. Access to this study is blocked to prevent incompatible reads or writes.'}{' '}
        Other studies, settings, and importing a new study remain available.
      </p>
      <p className="text-sm text-muted-foreground">
        You do not need to delete or reimport this study. If the problem persists, contact us with
        the diagnostic details below. Nothing is sent automatically.
      </p>
      <div className="flex flex-wrap gap-3 items-center">
        {canRetry && (
          <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {retry.isPending ? 'Updating…' : 'Retry update'}
          </Button>
        )}
        <Button variant="outline" onClick={() => copy.mutate()} disabled={copy.isPending}>
          {copy.isSuccess ? 'Diagnostics copied' : 'Copy diagnostic details'}
        </Button>
        <a
          href="https://www.earthtoolsmaker.org/contact/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Contact support
        </a>
      </div>
      {database.status === 'updating' && (
        <p role="status">This study’s database is being updated.</p>
      )}
      {retry.isSuccess && canRetry && (
        <p role="alert" className="text-sm text-muted-foreground">
          The study is still unavailable. Review the diagnostic details or contact support.
        </p>
      )}
      {retry.error && <p role="alert">Retry failed: {retry.error.message}</p>}
      {copy.error && <p role="alert">Could not copy diagnostics: {copy.error.message}</p>}
      <details className="rounded-md border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Diagnostic details</summary>
        <p className="mt-3 text-muted-foreground">
          Review these details before sharing. Error messages may contain local file paths.
        </p>
        <pre className="mt-3 whitespace-pre-wrap break-words text-xs">{diagnostics}</pre>
      </details>
    </section>
  )
}
