import { Mail } from 'lucide-react'

export default function CustomModelCard() {
  return (
    <div className="bg-card rounded-lg p-4 mb-2 border border-border border-dashed mt-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-medium text-sm text-foreground">Custom model for your region</span>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          Custom
        </span>
      </div>
      <div className="text-xs text-muted-foreground leading-snug mb-3">
        Don&apos;t see a model that fits your region or species? We can{' '}
        <span className="font-medium text-foreground">train one for you</span>, or integrate a model
        you already have.
      </div>
      <a
        href="https://www.earthtoolsmaker.org/contact"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-md border border-border bg-card text-foreground hover:bg-accent shadow-xs"
      >
        <Mail size={12} />
        Get in touch
      </a>
    </div>
  )
}
