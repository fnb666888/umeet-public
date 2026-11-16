import type { Generated } from 'kysely';
export interface BrowserAccountTables {
  browser_login_sets: {
    id: string;
    secret_hash: string;
    version: number;
    current_user_id: string | null;
    expires_at: Date;
  };
  browser_remembered_logins: {
    id: string;
    set_id: string;
    user_id: string;
    anchor_session_id: string;
    last_used_at: Date;
  };
}
export type BrowserSessionColumns = {
  browser_anchor: Generated<number>;
  browser_login_id: Generated<string | null>;
  browser_version: Generated<number | null>;
};
