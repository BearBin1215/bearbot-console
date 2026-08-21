import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import eslintReact from '@eslint-react/eslint-plugin';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/dist-electron/',
  ]),

  // #region 基础规则
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      // 通用规则
      curly: 2,
      'dot-notation': 2,
      eqeqeq: 2,
      'logical-assignment-operators': 2,
      'no-new-func': 2,
      'no-new-wrappers': 2,
      'no-object-constructor': 2,
      'no-var': 2,
      'no-misleading-character-class': 2,
      'no-template-curly-in-string': 2,
      'no-console': 1,
      'no-unused-vars': 0,
      'no-unreachable': 1,
      'no-inner-declarations': 0,
      'no-unneeded-ternary': 2,
      'no-else-return': 2,
      'no-empty': [2, { allowEmptyCatch: true }],
      'no-extra-bind': 2,
      'no-labels': 2,
      'no-lone-blocks': 2,
      'no-loop-func': 2,
      'no-magic-numbers': 0,
      'no-param-reassign': 2,
      '@typescript-eslint/no-shadow': 2,
      'no-nested-ternary': 2,
      'no-unused-expressions': 2,
      'no-useless-rename': 2,
      'no-useless-return': 2,
      'no-use-before-define': 2,
      'object-shorthand': 2,
      'one-var': [2, 'never'],
      'prefer-const': 2,
      'prefer-arrow-callback': 2,
      'prefer-spread': 2,
      'prefer-template': 2,
      'prefer-rest-params': 2,
      'prefer-exponentiation-operator': 2,
      'prefer-destructuring': 0,
      'require-await': 2,
      yoda: 2,

      '@typescript-eslint/ban-ts-comment': 0,
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/no-unused-vars': [2, {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],

      // stylistic 通用规则
      '@stylistic/arrow-parens': 2,
      '@stylistic/arrow-spacing': [2, { before: true, after: true }],
      '@stylistic/comma-dangle': [1, 'always-multiline'],
      '@stylistic/indent': [2, 2],
      '@stylistic/linebreak-style': 0,
      '@stylistic/max-len': [2, {
        code: 120,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreComments: true,
        ignoreTemplateLiterals: true,
      }],
      '@stylistic/no-floating-decimal': 2,
      '@stylistic/no-multi-spaces': 2,
      '@stylistic/no-trailing-spaces': 2,
      '@stylistic/quotes': 0,
      '@stylistic/quote-props': [1, 'as-needed', { unnecessary: true, numbers: false }],
      '@stylistic/semi': [2, 'always'],
      '@stylistic/spaced-comment': 2,
    },
  },
  // #endregion

  // #region 主进程
  {
    files: ['electron/**/*.ts', 'electron/**/*.js'],
    languageOptions: {
      parserOptions: {
        project: './electron/tsconfig.json',
      },
    },
    rules: {
      'no-console': 0,
    },
  },
  // #endregion

  // #region 渲染进程
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js', 'src/**/*.jsx'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@eslint-react': eslintReact,
    },
    rules: {
      // React 规则
      '@eslint-react/dom-no-dangerously-set-innerhtml': 0,
      '@eslint-react/exhaustive-deps': 0,
      '@eslint-react/no-class-component': 2,
      '@eslint-react/no-forward-ref': 2,
      '@eslint-react/jsx-no-useless-fragment': 1,

      // JSX 格式规则
      '@stylistic/jsx-closing-bracket-location': 2,
      '@stylistic/jsx-curly-brace-presence': 2,
      '@stylistic/jsx-equals-spacing': 2,
      '@stylistic/jsx-first-prop-new-line': [2, 'multiline'],
      '@stylistic/jsx-indent-props': [2, 2],
      '@stylistic/jsx-max-props-per-line': [2, { maximum: { single: 2, multi: 1 } }],
      '@stylistic/jsx-quotes': [0],
      '@stylistic/jsx-self-closing-comp': 2,
      '@stylistic/jsx-tag-spacing': 2,
      '@stylistic/jsx-wrap-multilines': [2, {
        declaration: 'parens-new-line',
        assignment: 'parens-new-line',
        return: 'parens-new-line',
        condition: 'parens-new-line',
        arrow: 'parens-new-line',
        logical: 'parens-new-line',
      }],
    },
  },
  // #endregion

  // #region 测试目录
  {
    files: ['test/**/*.ts', 'test/**/*.spec.ts'],
    languageOptions: {
      parserOptions: {
        project: './test/tsconfig.json',
      },
    },
    rules: {
      // 桩 API 常用 async 箭头函数但不使用 await
      'require-await': 0,
    },
  },
  // #endregion
);
