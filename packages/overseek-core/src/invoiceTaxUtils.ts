export interface InvoiceTaxDisplayOrderLike {
  prices_include_tax?: boolean;
  pricesIncludeTax?: boolean;
  tax_display_cart?: string;
  taxDisplayCart?: string;
  tax_display_shop?: string;
  taxDisplayShop?: string;
  display_prices_including_tax?: boolean;
  displayPricesIncludingTax?: boolean;
}

export interface InvoiceTaxDisplayLineItemLike {
  quantity?: number | string;
  total?: number | string;
  subtotal?: number | string;
  total_tax?: number | string;
  totalTax?: number | string;
  subtotal_tax?: number | string;
  subtotalTax?: number | string;
  taxes?: Array<{ total?: number | string; subtotal?: number | string }>;
  tax_lines?: Array<{ total?: number | string; subtotal?: number | string }>;
}

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isInclusiveDisplayValue = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'incl' || normalized === 'include' || normalized === 'inclusive' || normalized === 'yes';
};

export const shouldDisplayInvoicePricesIncludingTax = (order: InvoiceTaxDisplayOrderLike | null | undefined): boolean => {
  if (!order) return false;

  if (order.display_prices_including_tax === true || order.displayPricesIncludingTax === true) return true;
  if (isInclusiveDisplayValue(order.tax_display_cart) || isInclusiveDisplayValue(order.taxDisplayCart)) return true;
  if (isInclusiveDisplayValue(order.tax_display_shop) || isInclusiveDisplayValue(order.taxDisplayShop)) return true;

  return order.prices_include_tax === true || order.pricesIncludeTax === true;
};

export const getInvoiceLineTaxTotal = (item: InvoiceTaxDisplayLineItemLike | null | undefined): number => {
  if (!item) return 0;

  const directTax = item.total_tax ?? item.totalTax ?? item.subtotal_tax ?? item.subtotalTax;
  if (directTax !== undefined && directTax !== null) return toFiniteNumber(directTax);

  const taxes = Array.isArray(item.taxes) ? item.taxes : (Array.isArray(item.tax_lines) ? item.tax_lines : []);
  return taxes.reduce((sum, taxLine) => sum + toFiniteNumber(taxLine?.total ?? taxLine?.subtotal), 0);
};

export const getInvoiceLineDisplayTotal = (
  item: InvoiceTaxDisplayLineItemLike | null | undefined,
  pricesIncludeTax: boolean
): number => {
  if (!item) return 0;
  const lineTotal = toFiniteNumber(item.total);
  return pricesIncludeTax ? lineTotal + getInvoiceLineTaxTotal(item) : lineTotal;
};

export const getInvoiceLineDisplayUnitPrice = (
  item: InvoiceTaxDisplayLineItemLike | null | undefined,
  pricesIncludeTax: boolean
): number => {
  const quantity = toFiniteNumber(item?.quantity) || 1;
  return quantity > 0 ? getInvoiceLineDisplayTotal(item, pricesIncludeTax) / quantity : 0;
};
