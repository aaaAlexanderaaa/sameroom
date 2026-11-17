import { z } from "zod";

export const modelSourceSchema = z.strictObject({
  platform: z.string().trim().min(1).max(80).optional(),
  url: z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          /^https?:\/\/\S+$/i.test(value) && !url.username && !url.password
        );
      } catch {
        return false;
      }
    }, "Use an HTTP(S) model page without credentials.")
    .optional(),
  author: z.string().trim().min(1).max(160).optional(),
  license: z.string().trim().min(1).max(300).optional(),
});

export type ModelSource = z.infer<typeof modelSourceSchema>;

export interface ImportedModel {
  id: string;
  name: string;
  url: string;
  bytes: number;
  sha256: string;
  source?: ModelSource;
}
