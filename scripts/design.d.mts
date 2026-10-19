export function parseDesign(source: string): Record<string, any>;
export function generate(source: string): Record<string, string>;
export function checkOutput(outputs: Record<string, string>, write?: boolean): Promise<void>;
export function contrast(a: string, b: string): number;
export const contrastPairs: [string, string[], number][];
