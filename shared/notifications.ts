export interface PushStatus {
  registered: boolean;
  needsRepair: boolean;
  error?: string;
  lastAcceptedAt?: number;
}
export interface PushTest {
  id: string;
  state: 'sending' | 'accepted' | 'failed';
  shownAt?: number;
  error?: string;
}
