import { NavLink } from 'react-router'

// Utility function for conditional class names
function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

// Tab component
export function Tab({ to, icon: Icon, children, end = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        classNames(
          isActive
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
          'border-b-2 px-1 py-4 pb-3 text-sm font-medium whitespace-nowrap flex items-center gap-2'
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            size={20}
            className={classNames(
              isActive ? 'text-blue-600' : 'text-gray-500'
            )}
          />
          {children}
        </>
      )}
    </NavLink>
  )
}
