import * as Tooltip from '@radix-ui/react-tooltip'

/**
 * Shared explanatory tooltip for a numeric figure on the Deployments tab
 * (camera-days, observation counts). Bold headline, optional scope line,
 * then a plain-language explanation of what the figure measures.
 *
 * The trigger is rendered `asChild`, so `children` must be a single element
 * that forwards refs (a plain div/span is fine). Relies on the app-level
 * Tooltip.Provider mounted in base.jsx.
 */
export default function FigureTooltip({ headline, detail, explanation, side = 'left', children }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={8}
          collisionPadding={12}
          className="z-[10000] max-w-[17rem] rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
        >
          <p className="font-medium">{headline}</p>
          {detail && <p className="text-muted-foreground">{detail}</p>}
          <p className="mt-1.5 leading-snug text-muted-foreground">{explanation}</p>
          <Tooltip.Arrow className="fill-popover" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
