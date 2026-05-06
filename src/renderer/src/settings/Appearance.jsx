import { useTheme } from '../hooks/useTheme'
import ThemeSegmentedControl from '../ui/ThemeSegmentedControl'

export default function Appearance() {
  const { source, resolved, setSource } = useTheme()

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-foreground mb-1">Appearance</h2>
      <p className="text-sm text-muted-foreground mb-6">Choose how Biowatch looks.</p>

      <div className="mb-2">
        <ThemeSegmentedControl value={source} onChange={setSource} />
      </div>

      {source === 'system' && (
        <p className="text-sm text-muted-foreground">
          Following system preference (currently {resolved === 'dark' ? 'Dark' : 'Light'}).
        </p>
      )}
    </div>
  )
}
