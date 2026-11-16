'use client';
import { AccountCenter } from './community/Account';
import { CommunityProvider } from './community/store';
export function AccountSecurity() {
  return (
    <CommunityProvider>
      <AccountCenter />
    </CommunityProvider>
  );
}
