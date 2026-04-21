import eslint from '@electron-toolkit/eslint-config'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/python-environments'] },
  eslint,
  {
    // Bump language level to ES2025 so the parser accepts import attributes
    // (e.g. `import foo from './x.json' with { type: 'json' }`) used by
    // src/shared/commonNames/resolver.js to inline the dictionary for Vite.
    languageOptions: {
      ecmaVersion: 2025,
      parserOptions: { ecmaVersion: 2025 }
    }
  },
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      'react/prop-types': 'off'
    }
  },
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      // Disable new v7 rules that require code refactoring
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off'
    }
  },
  eslintConfigPrettier
]
