import { NavLink } from 'react-router'

// Utility function for conditional class names
function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

// Tab component
export function Tab({ to, icon: Icon, children, end = false, indicator = null, compact = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        classNames(
          isActive
            ? 'border-blue-600 text-blue-600 dark:text-blue-400'
            : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
          'border-b-2 px-1 py-4 pb-3 text-sm font-medium whitespace-nowrap flex items-center gap-2'
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            size={20}
            className={classNames(
              isActive ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'
            )}
          />
          <span className={compact ? 'sr-only xl:not-sr-only' : 'sr-only lg:not-sr-only'}>
            {children}
          </span>
          {indicator}
        </>
      )}
    </NavLink>
  )
}
