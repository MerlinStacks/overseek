export type ProductionRangeDraft = { min: string; max: string };

/** Empty pairs inherit/disable; zero is an explicit production-day offset. */
export function validateProductionRange(value: ProductionRangeDraft): string | null {
    if (value.min === '' && value.max === '') return null;
    if (value.min === '' || value.max === '') return 'Enter both minimum and maximum days, or leave both blank.';
    if (![value.min, value.max].every(part => /^\d+$/.test(part) && Number(part) <= 3650)) {
        return 'Production days must be whole numbers from 0 to 3650.';
    }
    if (Number(value.min) > Number(value.max)) return 'Minimum days cannot exceed maximum days.';
    return null;
}
