import * as SelectPrimitive from '@radix-ui/react-select'
import { useNavigate } from 'react-router'
import { CheckCircle2, AlertTriangle, Settings, ArrowRight } from 'lucide-react'
import { modelZoo } from '../../../shared/mlmodels.js'
import { getRegion } from './regions.js'
import { getModelInstallStatus } from './installStatus.js'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '../ui/select'

function RegionPill({ regionId }) {
  const region = getRegion(regionId)
  if (!region) return null
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground inline-flex items-center gap-1 flex-shrink-0">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: region.color }} aria-hidden />
      {region.label}
    </span>
  )
}

function StatusAffordance({ status }) {
  if (status === 'installed') {
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-500/30 inline-flex items-center gap-1 flex-shrink-0">
        <CheckCircle2 size={10} />
        Installed
      </span>
    )
  }
  if (status === 'env-missing') {
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-500/30 inline-flex items-center gap-1 flex-shrink-0">
        <AlertTriangle size={10} />
        Env missing
      </span>
    )
  }
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-500/30 inline-flex items-center gap-1 flex-shrink-0">
      Install in Settings
      <ArrowRight size={10} />
    </span>
  )
}

function ModelRow({ model, status }) {
  return (
    <div className="flex flex-col gap-1 py-1 w-full min-w-0">
      <div className="flex items-center justify-between gap-2 w-full">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-sm text-foreground truncate">{model.name}</span>
          <span className="text-xs text-muted-foreground">v{model.reference.version}</span>
        </div>
        <StatusAffordance status={status} />
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <RegionPill regionId={model.region} />
        <span>{model.species_count} species</span>
      </div>
      <p className="text-xs text-muted-foreground leading-snug line-clamp-2">{model.description}</p>
    </div>
  )
}

const FOOTER_VALUE = '__manage_models__'

/**
 * Rich-card model picker. Renders all entries from `modelZoo`:
 *   - installed rows: selectable, fire `onChange({ id, version })`
 *   - uninstalled / env-missing rows: navigate to /settings/ml_zoo with
 *     route state `{ highlightModel: { id, version } }` so the settings
 *     page can scroll-and-flash the matching card.
 *
 * Always renders a "Manage models in Settings →" footer entry.
 *
 * Props:
 *   value                 — { id, version } | null (currently selected model)
 *   onChange              — (ref) => void; called only for installed picks
 *   installedModels       — array from listInstalledMLModels()
 *   installedEnvironments — array from listInstalledMLModelEnvironments()
 *   onBeforeNavigate      — optional; called when an uninstalled row triggers
 *                           navigation (e.g. parent closes its modal first)
 *   triggerClassName      — optional Tailwind classes for the trigger
 *   placeholder           — string placeholder when no model is selected
 */
export default function ModelSelect({
  value,
  onChange,
  installedModels,
  installedEnvironments,
  onBeforeNavigate,
  triggerClassName,
  placeholder = 'Select a model'
}) {
  const navigate = useNavigate()

  const valueKey = value ? `${value.id}-${value.version}` : ''

  const handleValueChange = (key) => {
    if (key === FOOTER_VALUE) {
      onBeforeNavigate?.()
      navigate('/settings/ml_zoo')
      return
    }

    const [id, ...rest] = key.split('-')
    const version = rest.join('-')
    const model = modelZoo.find((m) => m.reference.id === id && m.reference.version === version)
    if (!model) return

    const status = getModelInstallStatus(model, installedModels, installedEnvironments)
    if (status === 'installed') {
      onChange({ id: model.reference.id, version: model.reference.version })
      return
    }
    onBeforeNavigate?.()
    navigate('/settings/ml_zoo', {
      state: { highlightModel: { id: model.reference.id, version: model.reference.version } }
    })
  }

  const selectedModel = value
    ? modelZoo.find((m) => m.reference.id === value.id && m.reference.version === value.version)
    : null

  return (
    <Select value={valueKey} onValueChange={handleValueChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={placeholder}>
          {selectedModel
            ? `${selectedModel.name} v${selectedModel.reference.version}`
            : placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-w-[min(560px,calc(100vw-2rem))] w-[var(--radix-select-trigger-width)] min-w-[320px]">
        <SelectGroup>
          {modelZoo.map((model) => {
            const status = getModelInstallStatus(model, installedModels, installedEnvironments)
            return (
              <SelectPrimitive.Item
                key={`${model.reference.id}-${model.reference.version}`}
                value={`${model.reference.id}-${model.reference.version}`}
                className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex w-full cursor-pointer items-start gap-2 rounded-sm py-2 px-2 text-sm outline-none select-none"
              >
                <ModelRow model={model} status={status} />
              </SelectPrimitive.Item>
            )
          })}
        </SelectGroup>
        <SelectSeparator />
        <SelectPrimitive.Item
          value={FOOTER_VALUE}
          className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 px-2 text-sm text-muted-foreground outline-none select-none"
        >
          <span className="inline-flex items-center gap-2">
            <Settings size={12} />
            Manage models in Settings
            <ArrowRight size={12} />
          </span>
        </SelectPrimitive.Item>
      </SelectContent>
    </Select>
  )
}
