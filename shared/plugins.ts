export const PLUGIN_API_VERSION = 1;
export interface PluginManifest {
    id: string;
    name: string;
    description: string;
    version: string;
    apiVersion: number;
    schemaVersion: number;
    routes?: string[];
    shortcuts?: {
        name: string;
        description: string;
        url: string;
    }[];
    client?: string;
    server?: string;
    icon?: string;
}
export interface PluginEntry {
    manifest: PluginManifest;
    enabled: boolean;
    available: boolean;
    generation: number;
    hash?: string;
    candidateHash?: string;
    candidateVersion?: string;
    status: 'available' | 'enabled' | 'unavailable' | 'incompatible' | 'failed';
    error?: string;
}
export interface PluginCatalogue {
    revision: number;
    order: string[];
    entries: PluginEntry[];
}
export interface PluginData {
    generation: number;
    revision: number;
    schemaVersion: number;
    records: Record<string, unknown>;
}
export interface PluginOperation {
    id: string;
    generation: number;
    command: string;
    input: unknown;
}
export interface SharedContent {
    title: string;
    text: string;
    url: string;
}
export const emptyCatalogue = (): PluginCatalogue => ({ revision: 0, order: ['conversations'], entries: [] });
