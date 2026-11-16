import * as communityGovernance from './migrations/029_community_governance.js';
import { Migrator, type Kysely } from 'kysely';
import type { Database } from './database.types.js';
import * as core from './migrations/001_core.js';
import * as identity from './migrations/002_identity.js';
import * as communities from './migrations/003_communities.js';
import * as jobs from './migrations/004_jobs.js';
import * as jobPrecision from './migrations/004b_job_precision.js';
import * as passwordAuth from './migrations/005_password_auth.js';
import * as wiki from './migrations/006_wiki.js';
import * as recordCapacity from './migrations/007_record_capacity.js';
import * as wikiLinks from './migrations/008_wiki_links.js';
import * as identityBinary from './migrations/009_identity_binary.js';
import * as otpAuth from './migrations/010_otp_auth.js';
import * as runtimeSettings from './migrations/011_runtime_settings.js';
import * as discussions from './migrations/012_discussions.js';
import * as demoSnapshots from './migrations/013_demo_snapshots.js';
import * as demoEntities from './migrations/014_demo_entities.js';
import * as accountCenter from './migrations/015_account_center.js';
import * as accountLifecycle from './migrations/016_account_lifecycle.js';
import * as unifiedUsername from './migrations/017_unified_username.js';
import * as messaging from './migrations/018_messaging.js';
import * as administration from './migrations/019_administration.js';
import * as moderationWorkspaces from './migrations/020_moderation_workspaces.js';
import * as moderationBusiness from './migrations/021_moderation_business.js';
import * as appealScope from './migrations/022_appeal_scope.js';
import * as moderationGroups from './migrations/023_moderation_groups.js';
import * as siteSettings from './migrations/024_site_settings.js';
import * as sitePolicies from './migrations/025_site_policies.js';
import * as groupManagement from './migrations/026_group_management.js';
import * as moderatorMemberBoards from './migrations/027_moderator_member_boards.js';
import * as moderationDispositions from './migrations/028_moderation_dispositions.js';
import * as governancePermissions from './migrations/030_governance_permissions.js';
import * as governanceBoardCapacity from './migrations/031_governance_board_capacity.js';
import * as knowledge from './migrations/032_knowledge.js';
import * as knowledgeLinks from './migrations/033_knowledge_links.js';
import * as browserAccounts from './migrations/034_browser_accounts.js';
import * as communityInterest from './migrations/035_community_interest.js';
import * as contentBoards from './migrations/036_content_boards.js';
import * as communityPageIndexes from './migrations/037_community_page_indexes.js';
export async function migrate(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: {
      getMigrations: async () => ({
        '001_core': core,
        '002_identity': identity,
        '003_communities': communities,
        '004_jobs': jobs,
        '004b_job_precision': jobPrecision,
        '005_password_auth': passwordAuth,
        '006_wiki': wiki,
        '007_record_capacity': recordCapacity,
        '008_wiki_links': wikiLinks,
        '009_identity_binary': identityBinary,
        '010_otp_auth': otpAuth,
        '011_runtime_settings': runtimeSettings,
        '012_discussions': discussions,
        '013_demo_snapshots': demoSnapshots,
        '014_demo_entities': demoEntities,
        '015_account_center': accountCenter,
        '016_account_lifecycle': accountLifecycle,
        '017_unified_username': unifiedUsername,
        '018_messaging': messaging,
        '019_administration': administration,
        '020_moderation_workspaces': moderationWorkspaces,
        '021_moderation_business': moderationBusiness,
        '022_appeal_scope': appealScope,
        '023_moderation_groups': moderationGroups,
        '024_site_settings': siteSettings,
        '025_site_policies': sitePolicies,
        '026_group_management': groupManagement,
        '027_moderator_member_boards': moderatorMemberBoards,
        '028_moderation_dispositions': moderationDispositions,
        '029_community_governance': communityGovernance,
        '030_governance_permissions': governancePermissions,
        '031_governance_board_capacity': governanceBoardCapacity,
        '032_knowledge': knowledge,
        '033_knowledge_links': knowledgeLinks,
        '034_browser_accounts': browserAccounts,
        '035_community_interest': communityInterest,
        '036_content_boards': contentBoards,
        '037_community_page_indexes': communityPageIndexes,
      }),
    },
  });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error;
}
