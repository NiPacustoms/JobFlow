/**
 * Legal/Impressum Configuration
 * 
 * Diese Datei enthält die Firmendaten (Dokument-Briefköpfe/-Fußzeilen)
 * und die Ziele der Rechtstext-Links.
 */

export interface LegalInfo {
  // Firmendaten
  companyName: string;
  legalForm: string; // z.B. "GmbH", "UG (haftungsbeschränkt)", etc.
  address: {
    street: string;
    city: string;
    zipCode: string;
    country: string;
  };
  
  // Kontakt
  contact: {
    email: string;
    phone?: string;
    fax?: string;
    website?: string;
  };
  
  // Registereintrag
  registration?: {
    registerType: string; // z.B. "Handelsregister"
    registerNumber: string; // z.B. "HRB 12345"
    registerCourt: string; // z.B. "Amtsgericht Musterstadt"
    vatId?: string; // USt-IdNr.
  };
  
  // Verantwortlich für den Inhalt
  responsiblePerson?: {
    name: string;
    position: string; // z.B. "Geschäftsführer"
  };

  // Steuerliche Angaben (für Dokument-Fußzeilen)
  taxNumber?: string; // Steuernummer, z. B. "359/5742/0930"

  // Bankverbindung (für Dokument-Fußzeilen)
  bank?: {
    name: string; // z. B. "Sparkasse Gelsenkirchen"
    iban: string;
    bic: string;
  };
}

/** Firmendaten (echte Daten der AufAbruf GmbH; per ENV überschreibbar). */
export const DEFAULT_LEGAL_INFO: LegalInfo = {
  // Echte Firmendaten der AufAbruf GmbH als Default (ENV kann weiterhin überschreiben).
  companyName: process.env.NEXT_PUBLIC_COMPANY_NAME || 'AufAbruf GmbH',
  legalForm: process.env.NEXT_PUBLIC_LEGAL_FORM || 'GmbH',
  address: {
    street: process.env.NEXT_PUBLIC_COMPANY_STREET || 'Herner Straße 134',
    city: process.env.NEXT_PUBLIC_COMPANY_CITY || 'Herten',
    zipCode: process.env.NEXT_PUBLIC_COMPANY_ZIP || '45699',
    country: process.env.NEXT_PUBLIC_COMPANY_COUNTRY || 'Deutschland',
  },
  contact: {
    email: process.env.NEXT_PUBLIC_COMPANY_EMAIL || 'info@aufabruf.eu',
    phone: process.env.NEXT_PUBLIC_COMPANY_PHONE || '02366 58 292 58',
    fax: process.env.NEXT_PUBLIC_COMPANY_FAX,
    website: process.env.NEXT_PUBLIC_COMPANY_WEBSITE || process.env.NEXT_PUBLIC_APP_URL || 'www.aufabruf.eu',
  },
  registration: {
    registerType: 'Handelsregister',
    registerNumber: process.env.NEXT_PUBLIC_REGISTER_NUMBER || 'HRB 9754',
    registerCourt: process.env.NEXT_PUBLIC_REGISTER_COURT || 'Amtsgericht Recklinghausen',
    vatId: process.env.NEXT_PUBLIC_VAT_ID || 'DE369 553 099',
  },
  responsiblePerson: {
    name: process.env.NEXT_PUBLIC_RESPONSIBLE_NAME || 'Christian Zak',
    position: process.env.NEXT_PUBLIC_RESPONSIBLE_POSITION || 'Geschäftsführer',
  },
  taxNumber: process.env.NEXT_PUBLIC_TAX_NUMBER || '359/5742/0930',
  bank: {
    name: process.env.NEXT_PUBLIC_BANK_NAME || 'Sparkasse Gelsenkirchen',
    iban: process.env.NEXT_PUBLIC_BANK_IBAN || 'DE88 4205 0001 0102 0122 10',
    bic: process.env.NEXT_PUBLIC_BANK_BIC || 'WELADED1GEK',
  },
};

/**
 * Rechtstext-Ziele: Die Web-App wird in eine bestehende Seite eingebunden,
 * die Impressum/Datenschutz/AGB bereits führt. Über diese ENV-Variablen
 * zeigen die Links der App dorthin; ohne Konfiguration greifen die
 * internen Platzhalter-Seiten.
 */
export const LEGAL_URLS = {
  impressum: process.env.NEXT_PUBLIC_IMPRESSUM_URL || '/recht/impressum',
  datenschutz: process.env.NEXT_PUBLIC_DATENSCHUTZ_URL || '/recht/datenschutz',
  agb: process.env.NEXT_PUBLIC_AGB_URL || '/recht/agb',
  avv: process.env.NEXT_PUBLIC_AVV_URL || '/recht/avv',
} as const;

/**
 * Historischer Produktions-Guard – bewusst entfernt (Entscheidung 21.07.2026):
 * Die App wird in eine bestehende Seite eingebunden, die Impressum/AGB/
 * Datenschutz führt, und DEFAULT_LEGAL_INFO enthält die echten Firmendaten
 * der AufAbruf GmbH. ENV-Variablen können weiterhin überschreiben.
 */

/** Liefert die Firmendaten (Defaults, per ENV überschreibbar). */
export function getLegalInfo(): LegalInfo {
  return DEFAULT_LEGAL_INFO;
}

