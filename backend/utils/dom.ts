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
  if (!snapshot || !Array.isArray(snapshot.fields)) {
    return { patientUuid: null, patientCode: null, surfacesFound: 0 };
  }

  return {
    patientUuid: null,
    patientCode: null,
    surfacesFound: snapshot.fields.length
  };
}
