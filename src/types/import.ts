export interface TravelPlace {
  id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  googlePlaceId?: string;
  googleMapsUrl?: string;
  country?: string;
  countryCode?: string;
  continent?: string;
  originalIndex: number;
  journeyIndex: number;
  visitedAt?: string;
}

export type ImportIssueCode = "missing_coordinates" | "invalid_coordinates";

export interface ImportIssue {
  originalIndex: number;
  name: string;
  code: ImportIssueCode;
  message: string;
}

export interface PlaceImportResult {
  source: "google-maps";
  listName: string;
  owner?: string;
  totalFound: number;
  places: TravelPlace[];
  issues: ImportIssue[];
  orderMode?: "manual" | "date";
}

export interface PlaceImporter {
  import(input: string): Promise<PlaceImportResult>;
}

export interface ImportApiError {
  error: {
    code: string;
    message: string;
    recovery?: string;
  };
}
