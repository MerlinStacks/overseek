export type InvoiceTemplateSettings = {
  locale: {
    locale: string;
    timezone: string;
    currency: string;
    dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | string;
  };
  numbering: {
    prefix: string;
    nextNumber: number;
    padding: number;
  };
  compliance: {
    taxIdLabel: string;
    taxIdValue: string;
    legalFooter: string;
    paymentTermsDays: number;
  };
  payment: {
    payNowUrl: string;
    payNowLabel: string;
    includeQrCode: boolean;
  };
  branding: {
    primaryColor: string;
    textColor: string;
    mutedColor: string;
    fontFamily: string;
    tableStyle: string;
    spacingScale: number;
  };
};

export const DEFAULT_INVOICE_TEMPLATE_SETTINGS: InvoiceTemplateSettings = {
  locale: {
    locale: 'en-AU',
    timezone: 'Australia/Sydney',
    currency: 'AUD',
    dateFormat: 'DD/MM/YYYY',
  },
  numbering: {
    prefix: 'INV-',
    nextNumber: 1001,
    padding: 5,
  },
  compliance: {
    taxIdLabel: 'ABN',
    taxIdValue: '',
    legalFooter: '',
    paymentTermsDays: 14,
  },
  payment: {
    payNowUrl: '',
    payNowLabel: 'Pay now',
    includeQrCode: true,
  },
  branding: {
    primaryColor: '#4f46e5',
    textColor: '#0f172a',
    mutedColor: '#64748b',
    fontFamily: 'Helvetica',
    tableStyle: 'classic',
    spacingScale: 1,
  },
};

export function mergeInvoiceSettings(input: any): InvoiceTemplateSettings {
  const base = input && typeof input === 'object' ? input : {};
  return {
    ...DEFAULT_INVOICE_TEMPLATE_SETTINGS,
    ...base,
    locale: {
      ...DEFAULT_INVOICE_TEMPLATE_SETTINGS.locale,
      ...(base.locale || {}),
    },
    numbering: {
      ...DEFAULT_INVOICE_TEMPLATE_SETTINGS.numbering,
      ...(base.numbering || {}),
    },
    compliance: {
      ...DEFAULT_INVOICE_TEMPLATE_SETTINGS.compliance,
      ...(base.compliance || {}),
    },
    payment: {
      ...DEFAULT_INVOICE_TEMPLATE_SETTINGS.payment,
      ...(base.payment || {}),
    },
    branding: {
      ...DEFAULT_INVOICE_TEMPLATE_SETTINGS.branding,
      ...(base.branding || {}),
    },
  };
}

export function formatInvoiceDate(
  date: Date,
  settings: InvoiceTemplateSettings
): string {
  const formatter = new Intl.DateTimeFormat(settings.locale.locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: settings.locale.timezone,
  });

  const parts = formatter.formatToParts(date);
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const year = parts.find((p) => p.type === 'year')?.value || '1970';

  if (settings.locale.dateFormat === 'MM/DD/YYYY') return `${month}/${day}/${year}`;
  if (settings.locale.dateFormat === 'YYYY-MM-DD') return `${year}-${month}-${day}`;
  return `${day}/${month}/${year}`;
}

export function buildInvoiceNumber(settings: InvoiceTemplateSettings): string {
  const prefix = String(settings.numbering.prefix ?? 'INV-');
  const nextNumber = Math.max(1, Number(settings.numbering.nextNumber ?? 1001));
  const padding = Math.max(1, Number(settings.numbering.padding ?? 5));
  return `${prefix}${String(nextNumber).padStart(padding, '0')}`;
}

export function formatInvoiceCurrency(
  value: number | string,
  settings: InvoiceTemplateSettings,
  currencyOverride?: string
): string {
  const num = Number(value || 0);
  const currency = currencyOverride || settings.locale.currency || 'USD';
  try {
    return new Intl.NumberFormat(settings.locale.locale, {
      style: 'currency',
      currency,
    }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

export function resolveInvoiceTemplateString(
  text: string,
  context: Record<string, any>
): string {
  return String(text || '').replace(/\{\{(.*?)\}\}/g, (_: string, key: string) => {
    const parts = key.trim().split('.');
    let value: any = context;
    for (const part of parts) value = value?.[part];
    return value != null ? String(value) : `{{${key.trim()}}}`;
  });
}

