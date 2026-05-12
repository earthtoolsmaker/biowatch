import { useTheme } from '../hooks/useTheme'
import ThemeSegmentedControl from '../ui/ThemeSegmentedControl'

/**
 * "General" settings tab. Right now hosts only the theme control; the
 * `divide-y` layout matches `SettingsInfo` and leaves room for additional
 * sections (language, density, etc.) without restructuring.
 */
export default function Appearance() {
  const { source, resolved, setSource } = useTheme()

  return (
    <div className="px-4 sm:px-6">
      <div className="max-w-2xl mx-auto divide-y divide-border">
        <section className="py-6">
          <h2 className="text-base font-medium text-foreground mb-1">Appearance</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Choose how Biowatch looks. <span className="font-medium">System</span> matches your
            operating system preference.
          </p>

          <ThemeSegmentedControl value={source} onChange={setSource} />

          {source === 'system' && (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="theme-system-helper">
              Currently following your system preference:{' '}
              <span className="font-medium text-foreground">
                {resolved === 'dark' ? 'Dark' : 'Light'}
              </span>
              .
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
