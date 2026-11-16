import { describe, it, expect } from 'vitest';
import { SaveRevisionSchema, ProfileUpdateSchema, UploadReservationSchema } from '../src/index.js';
describe('public boundary schemas', () => {
  it('rejects caller controlled role escalation', () => {
    expect(ProfileUpdateSchema.safeParse({nickname:'南星',platformRoles:['owner']}).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({nickname:'南星'}).success).toBe(true);
  });
  it('requires a concrete base revision for saving existing wiki pages', () => {
    expect(SaveRevisionSchema.safeParse({title:'熵',markdown:'解释',baseRevisionId:'v1',changeNote:'纠错',idempotencyKey:'12345678'}).success).toBe(true);
    expect(SaveRevisionSchema.safeParse({title:'熵',markdown:'解释'}).success).toBe(false);
  });
  it('enforces decimal 100 MB file boundary and nonempty file identifiers', () => {
    expect(UploadReservationSchema.safeParse({sizeBytes:100000000,mime:'application/pdf',filename:'讲义.pdf',key:'12345678'}).success).toBe(true);
    expect(UploadReservationSchema.safeParse({sizeBytes:100000001,mime:'application/pdf',filename:'讲义.pdf',key:'12345678'}).success).toBe(false);
  });
});
