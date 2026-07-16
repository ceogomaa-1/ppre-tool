import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";
import type { ParsedDataset, PropertyLead } from "./types";

const aliases: Record<string, string[]> = {
  owner: ["owner", "owner name", "property owner", "full name", "name"],
  address: ["address", "property address", "street address", "street"],
  city: ["city", "municipality", "town"],
  province: ["province", "state", "region"],
  postalCode: ["postal code", "postcode", "zip", "zip code"],
  phone: ["phone", "phone number", "telephone", "mobile"],
  email: ["email", "email address", "e-mail"],
  propertyType: ["property type", "asset type", "building type", "type"],
};

const clean = (value: unknown) => String(value ?? "").trim();
const normalized = (value: string) => value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

function inferMapping(headers: string[]) {
  return Object.fromEntries(
    Object.entries(aliases).map(([field, names]) => {
      const header = headers.find((candidate) => names.includes(normalized(candidate)));
      return [field, header ?? null];
    }),
  );
}

export async function parseDataset(file: File): Promise<ParsedDataset> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  let rows: Record<string, string>[] = [];
  let headers: string[] = [];

  if (extension === "csv" || extension === "tsv") {
    const parsed = Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      delimiter: extension === "tsv" ? "\t" : "",
      transformHeader: (header) => clean(header),
      transform: (value) => clean(value),
    });
    if (parsed.errors.length) throw new Error(parsed.errors[0]?.message ?? "Could not read this file.");
    rows = parsed.data;
    headers = parsed.meta.fields ?? [];
  } else if (extension === "xlsx") {
    const sheet = await readXlsxFile(file);
    headers = (sheet[0] ?? []).map(clean);
    rows = sheet.slice(1).filter((row) => row.some((cell) => clean(cell))).map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, clean(row[index])])),
    );
  } else {
    throw new Error("Use a CSV, TSV or XLSX file.");
  }

  if (!headers.length || !rows.length) throw new Error("This file does not contain a usable header row and records.");
  if (rows.length > 25_000) throw new Error("This workspace accepts up to 25,000 rows per import.");

  return { fileName: file.name, file, headers, rows, mapping: inferMapping(headers) };
}

export function datasetToLeads(dataset: ParsedDataset): PropertyLead[] {
  const value = (row: Record<string, string>, field: string) => {
    const header = dataset.mapping[field];
    return header ? clean(row[header]) : "";
  };

  return dataset.rows.map((row, index) => ({
    id: `import-${Date.now()}-${index}`,
    owner: value(row, "owner") || `Record ${index + 1}`,
    address: value(row, "address") || "Address not provided",
    city: value(row, "city"),
    province: value(row, "province"),
    postalCode: value(row, "postalCode"),
    email: value(row, "email") || null,
    phone: value(row, "phone") || null,
    propertyType: value(row, "propertyType") || "Unknown",
    confidence: value(row, "email") || value(row, "phone") ? 52 : 0,
    status: "queued",
    sources: [],
    updatedAt: "Queued",
  }));
}
