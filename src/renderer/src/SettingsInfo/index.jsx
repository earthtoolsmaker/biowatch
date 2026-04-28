import AboutSection from './AboutSection'
import RecentReleases from './RecentReleases'
import StorageBreakdown from './StorageBreakdown'
import SupportLinks from './SupportLinks'
import LicenseSection from './LicenseSection'

export default function SettingsInfo({ version, platform }) {
  return (
    <div className="px-4 sm:px-6">
      <div className="max-w-2xl mx-auto divide-y divide-gray-200">
        <section className="py-6">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-semibold text-gray-900">Biowatch</h1>
            <span className="text-sm text-gray-500">
              v{version} · {platform}
            </span>
          </div>
        </section>
        <AboutSection />
        <RecentReleases />
        <StorageBreakdown />
        <SupportLinks />
        <LicenseSection />
      </div>
    </div>
  )
}
