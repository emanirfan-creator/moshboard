// Sucrase ships its types under dist/types; these map the parser entry points used by
// autoParams and detect-motion (CJS paths, so they load in Node and in Vite).
declare module 'sucrase/dist/parser/index.js' {
  export function parse(
    input: string,
    isJSXEnabled: boolean,
    isTypeScriptEnabled: boolean,
    isFlowEnabled: boolean,
  ): { tokens: { type: number; start: number; end: number }[] }
}
declare module 'sucrase/dist/parser/tokenizer/types.js' {
  export { TokenType } from 'sucrase/dist/types/parser/tokenizer/types'
}
