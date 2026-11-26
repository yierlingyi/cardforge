declare module 'diff' {
  export interface Change {
    value: string;
    added?: boolean;
    removed?: boolean;
    count?: number;
  }
  export function diffLines(a: string, b: string, options?: any): Change[];
  export function diffWords(a: string, b: string, options?: any): Change[];
  export function diffChars(a: string, b: string, options?: any): Change[];
}
