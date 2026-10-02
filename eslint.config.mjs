import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['extension/out/**', 'extension/bin/**'] },
  tseslint.configs.recommended,
  {
    files: ['extension/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/naming-convention': ['error',
        { selector: ['variable', 'function', 'parameter'], format: ['snake_case', 'UPPER_CASE'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] }
      ]
    }
  }
);
