export type LeadStatus = "verified" | "reviewing" | "queued" | "attention";

export type Evidence = {
  label: string;
  url: string;
  detail: string;
  capturedAt: string;
};

export type PropertyLead = {
  id: string;
  owner: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  email: string | null;
  phone: string | null;
  propertyType: string;
  confidence: number;
  status: LeadStatus;
  sources: Evidence[];
  updatedAt: string;
};

export type ParsedDataset = {
  fileName: string;
  file: File;
  headers: string[];
  rows: Record<string, string>[];
  mapping: Record<string, string | null>;
};
