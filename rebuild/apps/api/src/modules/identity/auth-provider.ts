export type VerifiedIdentity = { provider: string; subject: string; kind: 'guest' | 'member' };
/** Server-only port. Never accept VerifiedIdentity from request JSON. */
export interface AuthProvider {
  verify(token: string): Promise<VerifiedIdentity>;
}
/** Constructed only by a server-side verifier; never a request DTO. */
export type VerifiedLoginProof = {
  identities: readonly { provider: string; subject: string }[];
  nickname: string;
};
