export interface AuthoringGuideMetadata {
  formatVersion: number;
  sourceRoot: string;
  sourceDigest: string;
  sha256: string;
  byteLength: number;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}
export interface AuthoringGuideBundle { text: string; metadata: AuthoringGuideMetadata }
export const SOURCE_ROOT: string;
export const SUPPORT_DOCS: string[];
export const EXCLUDED_NAVIGATION: string[];
export function checkedPath(root: string, path: string): string;
export function validateReferences(sources: Array<{ path: string; text: string }>): void;
export function buildAuthoringGuide(root?: string): AuthoringGuideBundle;
export function readBuiltAuthoringGuide(root?: string): AuthoringGuideBundle;
export function loadAuthoringGuide(root?: string): AuthoringGuideBundle;
