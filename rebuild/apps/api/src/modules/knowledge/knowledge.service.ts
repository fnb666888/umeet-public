import type { KnowledgeDb } from './knowledge-core.js';
import { KnowledgeAccess } from './knowledge-access.js';
import { KnowledgeReadService } from './knowledge-read.service.js';
import { KnowledgePublishService } from './knowledge-publish.service.js';
import { KnowledgeDraftsService } from './knowledge-drafts.service.js';
import { KnowledgeRelationsService } from './knowledge-relations.service.js';
import { KnowledgeDirectoriesService } from './knowledge-directories.service.js';
import { KnowledgeRoutesService } from './knowledge-routes.service.js';
import { KnowledgeOrganizationProposalsService } from './knowledge-organization-proposals.service.js';
import { KnowledgeGovernanceService } from './knowledge-governance.service.js';
import { KnowledgeNotificationsService } from './knowledge-notifications.service.js';
import { KnowledgeDiscussionsService } from './knowledge-discussions.service.js';
// Transport facade; each domain unit owns its validation and transaction boundaries.
export class KnowledgeService {
  readonly access: KnowledgeAccess;
  readonly reader: KnowledgeReadService;
  readonly publisher: KnowledgePublishService;
  readonly drafts: KnowledgeDraftsService;
  readonly links: KnowledgeRelationsService;
  readonly directories: KnowledgeDirectoriesService;
  readonly routes: KnowledgeRoutesService;
  readonly organizations: KnowledgeOrganizationProposalsService;
  readonly governance: KnowledgeGovernanceService;
  readonly notifications: KnowledgeNotificationsService;
  readonly discussions: KnowledgeDiscussionsService;
  constructor(db: KnowledgeDb) {
    this.access = new KnowledgeAccess(db);
    this.reader = new KnowledgeReadService(db);
    this.publisher = new KnowledgePublishService(db);
    this.drafts = new KnowledgeDraftsService(db);
    this.links = new KnowledgeRelationsService(db);
    this.directories = new KnowledgeDirectoriesService(db);
    this.routes = new KnowledgeRoutesService(db);
    this.organizations = new KnowledgeOrganizationProposalsService(db);
    this.governance = new KnowledgeGovernanceService(db);
    this.notifications = new KnowledgeNotificationsService(db);
    this.discussions = new KnowledgeDiscussionsService(db);
  }
  create(...args: Parameters<KnowledgePublishService['create']>) {
    return this.publisher.create(...args);
  }
  publish(...args: Parameters<KnowledgePublishService['publish']>) {
    return this.publisher.publish(...args);
  }
  submit(...args: Parameters<KnowledgePublishService['submit']>) {
    return this.publisher.submit(...args);
  }
  review(...args: Parameters<KnowledgePublishService['review']>) {
    return this.publisher.review(...args);
  }
  proposals(...args: Parameters<KnowledgePublishService['proposals']>) {
    return this.publisher.proposals(...args);
  }
  read(...args: Parameters<KnowledgeReadService['readPublished']>) {
    return this.reader.readPublished(...args);
  }
  search(...args: Parameters<KnowledgeReadService['search']>) {
    return this.reader.search(...args);
  }
  history(...args: Parameters<KnowledgeReadService['history']>) {
    return this.reader.history(...args);
  }
  resolveTitle(...args: Parameters<KnowledgeReadService['resolveTitle']>) {
    return this.reader.resolveTitle(...args);
  }
  saveDraft(...args: Parameters<KnowledgeDraftsService['save']>) {
    return this.drafts.save(...args);
  }
  draft(...args: Parameters<KnowledgeDraftsService['readOwn']>) {
    return this.drafts.readOwn(...args);
  }
  relations(...args: Parameters<KnowledgeRelationsService['listPublished']>) {
    return this.links.listPublished(...args);
  }
  saveDirectory(...args: Parameters<KnowledgeDirectoriesService['apply']>) {
    return this.directories.apply(...args);
  }
  community(...args: Parameters<KnowledgeDirectoriesService['community']>) {
    return this.directories.community(...args);
  }
  saveRoute(...args: Parameters<KnowledgeRoutesService['save']>) {
    return this.routes.save(...args);
  }
  route(...args: Parameters<KnowledgeRoutesService['read']>) {
    return this.routes.read(...args);
  }
  confirmStep(...args: Parameters<KnowledgeRoutesService['confirmStep']>) {
    return this.routes.confirmStep(...args);
  }
  suggestOrganization(...args: Parameters<KnowledgeOrganizationProposalsService['submit']>) {
    return this.organizations.submit(...args);
  }
  reviewOrganization(...args: Parameters<KnowledgeOrganizationProposalsService['review']>) {
    return this.organizations.review(...args);
  }
  deliverPending() {
    return this.notifications.deliverPending();
  }
  raiseDispute(...args: Parameters<KnowledgeGovernanceService['raiseDispute']>) {
    return this.governance.raiseDispute(...args);
  }
  decideDispute(...args: Parameters<KnowledgeGovernanceService['decideDispute']>) {
    return this.governance.decideDispute(...args);
  }
  setVisibility(...args: Parameters<KnowledgeGovernanceService['setVisibility']>) {
    return this.governance.setVisibility(...args);
  }
  purge(...args: Parameters<KnowledgeGovernanceService['purge']>) {
    return this.governance.purge(...args);
  }
}
