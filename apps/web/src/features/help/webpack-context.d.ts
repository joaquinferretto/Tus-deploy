// webpack's `require.context`: every file of a directory that matches a pattern, resolved at
// BUILD time. The Help Center uses it to read docs/conocimiento as text (see help-content.ts).
declare namespace NodeJS {
  interface Require {
    context(directory: string, deep: boolean, filter: RegExp): { keys(): string[]; (key: string): string }
  }
}
