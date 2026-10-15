export const speechPreferenceKey = 'herts:speech-provider';
export type SpeechProvider = 'device' | 'hermes';
export function readSpeechProvider(): SpeechProvider {
 try { return localStorage.getItem(speechPreferenceKey) === 'hermes' ? 'hermes' : 'device'; }
 catch { return 'device'; }
}
