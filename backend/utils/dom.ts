export interface DomField {
  kind: 'text' | 'textarea' | 'number' | 'date';
  label?: string;
  selector: string;
  value?: string;
}

export interface DomSnapshot {
  url: string;
  fields: DomField[];
}

export interface DomMappingResult {
  patientUuid: string | null;
  patientCode: string | null;
  surfacesFound: number;
}

export function analyzeDomSnapshot(snapshot: DomSnapshot): DomMappingResult {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray((snapshot as DomSnapshot).fields)) {
    return { patientUuid: null, patientCode: null, surfacesFound: 0 };
  }

  const surfacesFound = snapshot.fields.length;
  return { patientUuid: null, patientCode: null, surfacesFound };
}
