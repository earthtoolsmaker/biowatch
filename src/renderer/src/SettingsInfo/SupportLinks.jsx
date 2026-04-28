import { Bug, Book, Github, Earth } from 'lucide-react'

const LINKS = [
  {
    label: 'Report a bug',
    href: 'https://github.com/earthtoolsmaker/biowatch/issues/new',
    icon: Bug
  },
  {
    label: 'Documentation',
    href: 'https://biowatch.earthtoolsmaker.org/',
    icon: Book
  },
  {
    label: 'GitHub',
    href: 'https://github.com/earthtoolsmaker/biowatch',
    icon: Github
  },
  {
    label: 'Website',
    href: 'https://www.earthtoolsmaker.org/tools/biowatch/',
    icon: Earth
  }
]

export default function SupportLinks() {
  return (
    <section className="py-6">
      <h2 className="text-base font-medium text-gray-900 mb-1">Support &amp; links</h2>
      <p className="text-sm text-gray-500 mb-3">Help, source code, and where to find us.</p>
      <ul className="space-y-1.5">
        {LINKS.map(({ label, href, icon: Icon }) => (
          <li key={label}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
            >
              <Icon size={14} />
              {label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
