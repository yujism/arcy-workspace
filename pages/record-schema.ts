import {z} from 'zod';
export const MAX_RECORDS = 5000;
export const recordSchema = z.object({
  id:z.string().min(1).max(200), kind:z.enum(['task','note','event','message']),
  title:z.string().trim().min(1).max(3000), body:z.string().max(100000),
  meta:z.record(z.unknown()), updated:z.string().datetime(),
});
