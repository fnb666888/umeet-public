import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AccountSessionProvider } from '../components/AccountSessionProvider';
import { ApplicationShell } from '../components/ApplicationShell';
import { ThemeProvider } from '../components/community/Theme';
import { initialActor } from '../lib/initial-actor-server';
import { communityBootstrap } from '../lib/community-bootstrap-server';
import { CommunityProvider } from '../components/community/store';
import { MessagingProvider } from '../components/community/messaging';
import { NavigationRuntime } from '../components/NavigationRuntime';
import '../../public/demo/css/style.css';
import '../components/community/community.css';
export const metadata: Metadata = {
  title: 'Umeet · 社区与知识',
  description: '发现社区，一起完善知识。',
};
export default async function Layout({ children }: { children: ReactNode }) {
  const [snapshot, actor] = await Promise.all([communityBootstrap(), initialActor()]);
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('umeet-theme');document.documentElement.dataset.theme=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch(e){}",
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <AccountSessionProvider initialActor={snapshot?.actor ?? actor}>
            <CommunityProvider initialData={snapshot}><MessagingProvider>
              <NavigationRuntime />
              <ApplicationShell>{children}</ApplicationShell>
            </MessagingProvider></CommunityProvider>
          </AccountSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
