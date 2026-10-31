import { isRecord } from "@/lib/tinyfish/http";

export interface InvestigationInput {
  brand: string;
  product_category: string;
  product_model: string | null;
  pincode: string;
}

export type ParseResult = { ok: true; value: InvestigationInput } | { ok: false; errors: Record<string, string> };

const TEXT = /^[\p{L}\p{N}][\p{L}\p{N} &.+\-/()']*$/u;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9 .\-/]*$/;
const PIN = /^[1-9][0-9]{5}$/; // Indian PIN codes never start with 0

const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

export function parseInvestigationInput(body: unknown): ParseResult {
  if (!isRecord(body)) return { ok: false, errors: { body: "Expected a JSON object" } };
  const brand = clean(body.brand);
  const category = clean(body.product_category);
  const model = clean(body.product_model);
  const pincode = clean(body.pincode);
  const errors: Record<string, string> = {};
  if (!brand || brand.length > 60 || !TEXT.test(brand)) errors.brand = "Brand is required (max 60 characters, letters and numbers)";
  if (!category || category.length > 60 || !TEXT.test(category)) errors.product_category = "Product category is required (max 60 characters)";
  if (model && (model.length > 60 || !MODEL.test(model))) errors.product_model = "Model may contain letters, numbers, spaces, '.', '-' and '/' (max 60)";
  if (!PIN.test(pincode)) errors.pincode = "PIN code must be 6 digits and cannot start with 0";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { brand, product_category: category, product_model: model || null, pincode } };
}
